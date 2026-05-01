import "server-only"
import { cache } from "react"
import { prisma } from "@/lib/prisma"
import {
  getMockAlertsForDevice,
  getMockDevices,
  synthesizeDeviceActivity,
  synthesizeFleetActivity,
  getMockAlertsAll,
} from "@/lib/mock-fleet"
import type { ActivityItem } from "@/components/ActivityFeed"
import { relativeLastSeen } from "./devices-time"

/**
 * `mockMode()` is true when the live `fl_devices` table has zero
 * active rows — that's the signal "no agents have enrolled, fall
 * back to seed data everywhere." Cached for the duration of a
 * single request via React's cache() so /devices, /alerts, dashboard,
 * and Cmd-K all hit the DB once instead of N times.
 */
export const mockMode = cache(async (): Promise<boolean> => {
  const c = await prisma.fl_Device.count({ where: { isActive: true } })
  return c === 0
})

/**
 * Read-side abstraction over `Fl_Device`. Today's job: design the
 * /devices and /devices/[id] UIs against a synthetic fleet so the
 * shape is locked before the agent ships (see docs/AGENT-PROTOCOL.md
 * §inventory.collect).
 *
 * If the DB has no active devices, this falls back to seed data from
 * `mock-fleet.ts`. The moment the first agent enrolls and writes a
 * row, the fallback shuts off and only DB rows show. Mock devices are
 * tagged `isMock: true` so the UI can surface a "seed data" banner.
 */

export interface InventorySnapshot {
  hardware: {
    manufacturer: string
    model: string
    serial: string
    cpu: string
    ramGb: number
    diskGb: number
    diskFreeGb: number
    biosVersion: string
    biosDate: string
    purchaseDate: string
  }
  os: {
    family: "windows" | "linux" | "darwin"
    version: string
    build: string
    installedAt: string
    lastBootAt: string
    timezone: string
  }
  patches: { lastChecked: string; pending: number; failed: number }
  software: { totalInstalled: number; sample: string[] }
  health: { cpu7d: number; ramPct: number; diskPct: number }
  network: {
    interfaces: Array<{
      name: string
      mac?: string
      ipv4?: string[]
      ipv6?: string[]
      up: boolean
      speedMbps?: number
    }>
    listeningPorts: Array<{
      protocol: string
      address: string
      process?: string
    }>
    recentConnections: Array<{
      protocol: string
      local: string
      remote: string
      state: string
    }>
  }
}

export interface DeviceAlert {
  id: string
  deviceId: string
  clientName: string | null
  kind: string
  severity: "info" | "warn" | "critical"
  title: string
  detail: string | null
  state: "open" | "ack" | "resolved"
  createdAt: Date
}

export interface DeviceRow {
  id: string
  clientName: string
  hostname: string
  os: "windows" | "linux" | "darwin" | null
  osVersion: string | null
  role: string | null
  ipAddress: string | null
  isOnline: boolean
  lastSeenAt: Date | null
  inventory: InventorySnapshot | null
  alertCount: number
  isMock: boolean
}

export interface DeviceFilters {
  q?: string
  client?: string
  os?: "windows" | "linux" | "darwin"
  online?: "online" | "offline"
  role?: string
  sort?: "lastSeen" | "hostname" | "alerts"
}

export interface DeviceListResult {
  rows: DeviceRow[]
  totalBeforeFilter: number
  isMock: boolean
  facets: {
    clients: Array<{ name: string; count: number }>
    osCounts: { windows: number; linux: number; darwin: number }
    onlineCounts: { online: number; offline: number }
    roles: Array<{ name: string; count: number }>
  }
}

export async function listDevices(filters: DeviceFilters = {}): Promise<DeviceListResult> {
  const isMock = await mockMode()
  let rows: DeviceRow[]

  if (isMock) {
    rows = getMockDevices()
  } else {
    const live = await prisma.fl_Device.findMany({ where: { isActive: true } })
    const alertCounts = await prisma.fl_Alert.groupBy({
      by: ["deviceId"],
      where: { state: "open", deviceId: { in: live.map((d) => d.id) } },
      _count: { _all: true },
    })
    const alertByDevice = new Map(alertCounts.map((a) => [a.deviceId ?? "", a._count._all]))
    rows = live.map((d) => ({
      id: d.id,
      clientName: d.clientName,
      hostname: d.hostname,
      os: (d.os as DeviceRow["os"]) ?? null,
      osVersion: d.osVersion,
      role: d.role,
      ipAddress: d.ipAddress,
      isOnline: d.isOnline,
      lastSeenAt: d.lastSeenAt,
      inventory: parseInventory(d.inventoryJson),
      alertCount: alertByDevice.get(d.id) ?? 0,
      isMock: false,
    }))
  }

  const totalBeforeFilter = rows.length
  const facets = computeFacets(rows)

  if (filters.q) {
    const needle = filters.q.toLowerCase()
    rows = rows.filter((r) =>
      r.hostname.toLowerCase().includes(needle) ||
      r.clientName.toLowerCase().includes(needle) ||
      (r.ipAddress ?? "").toLowerCase().includes(needle) ||
      (r.role ?? "").toLowerCase().includes(needle),
    )
  }
  if (filters.client) rows = rows.filter((r) => r.clientName === filters.client)
  if (filters.os) rows = rows.filter((r) => r.os === filters.os)
  if (filters.online === "online") rows = rows.filter((r) => r.isOnline)
  if (filters.online === "offline") rows = rows.filter((r) => !r.isOnline)
  if (filters.role) rows = rows.filter((r) => r.role === filters.role)

  rows.sort(sortComparator(filters.sort ?? "lastSeen"))

  return { rows, totalBeforeFilter, isMock, facets }
}

export async function getDevice(id: string): Promise<DeviceRow | null> {
  if (await mockMode()) {
    return getMockDevices().find((d) => d.id === id) ?? null
  }
  const live = await prisma.fl_Device.findUnique({ where: { id } })
  if (!live || !live.isActive) return null
  const alertCount = await prisma.fl_Alert.count({
    where: { deviceId: live.id, state: "open" },
  })
  return {
    id: live.id,
    clientName: live.clientName,
    hostname: live.hostname,
    os: (live.os as DeviceRow["os"]) ?? null,
    osVersion: live.osVersion,
    role: live.role,
    ipAddress: live.ipAddress,
    isOnline: live.isOnline,
    lastSeenAt: live.lastSeenAt,
    inventory: parseInventory(live.inventoryJson),
    alertCount,
    isMock: false,
  }
}

function parseInventory(json: string | null): InventorySnapshot | null {
  if (!json) return null
  try {
    const raw = JSON.parse(json) as Partial<InventorySnapshot>
    // Network is a Phase 1.5 addition — older rows (and synthetic
    // pre-Phase-1.5 fixtures) won't have it. Default rather than
    // forcing render code to null-check every access.
    return {
      ...raw,
      network: raw.network ?? {
        interfaces: [],
        listeningPorts: [],
        recentConnections: [],
      },
    } as InventorySnapshot
  } catch {
    return null
  }
}

function computeFacets(rows: DeviceRow[]): DeviceListResult["facets"] {
  const clients = new Map<string, number>()
  const osCounts = { windows: 0, linux: 0, darwin: 0 }
  const onlineCounts = { online: 0, offline: 0 }
  const roles = new Map<string, number>()
  for (const r of rows) {
    clients.set(r.clientName, (clients.get(r.clientName) ?? 0) + 1)
    if (r.os && r.os in osCounts) osCounts[r.os] += 1
    if (r.isOnline) onlineCounts.online += 1
    else onlineCounts.offline += 1
    if (r.role) roles.set(r.role, (roles.get(r.role) ?? 0) + 1)
  }
  const sortedClients = [...clients.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }))
  const sortedRoles = [...roles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }))
  return { clients: sortedClients, osCounts, onlineCounts, roles: sortedRoles }
}

function sortComparator(sort: NonNullable<DeviceFilters["sort"]>) {
  return (a: DeviceRow, b: DeviceRow): number => {
    if (sort === "hostname") return a.hostname.localeCompare(b.hostname)
    if (sort === "alerts") {
      if (b.alertCount !== a.alertCount) return b.alertCount - a.alertCount
      return a.hostname.localeCompare(b.hostname)
    }
    // "lastSeen" — online first, then most-recently-seen, then hostname
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1
    const aSeen = a.lastSeenAt?.getTime() ?? 0
    const bSeen = b.lastSeenAt?.getTime() ?? 0
    if (bSeen !== aSeen) return bSeen - aSeen
    return a.hostname.localeCompare(b.hostname)
  }
}

export { relativeLastSeen } from "./devices-time"

export async function getDeviceAlerts(deviceId: string): Promise<DeviceAlert[]> {
  if (await mockMode()) {
    return getMockAlertsForDevice(deviceId)
  }
  const rows = await prisma.fl_Alert.findMany({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
    take: 50,
  })
  return rows.map((r) => ({
    id: r.id,
    deviceId: r.deviceId ?? deviceId,
    clientName: r.clientName,
    kind: r.kind,
    severity: (r.severity as DeviceAlert["severity"]) ?? "info",
    title: r.title,
    detail: r.detailJson,
    state: (r.state as DeviceAlert["state"]) ?? "open",
    createdAt: r.createdAt,
  }))
}

export async function getDeviceActivity(deviceId: string, limit = 20): Promise<ActivityItem[]> {
  if (await mockMode()) {
    return synthesizeDeviceActivity(deviceId, limit)
  }
  const rows = await prisma.fl_AuditLog.findMany({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return rows.map((r) => {
    let detail: string | undefined
    if (r.detailJson) {
      try {
        const parsed = JSON.parse(r.detailJson) as Record<string, unknown>
        const msg = typeof parsed.message === "string" ? parsed.message : null
        if (msg) detail = msg
      } catch {
        // ignore — detailJson isn't guaranteed JSON
      }
    }
    return {
      id: r.id,
      ts: relativeLastSeen(r.createdAt),
      actor: r.actorEmail,
      action: r.action,
      outcome: r.outcome as "ok" | "error" | "pending",
      detail,
    }
  })
}

export interface DeviceScriptRun {
  id: string
  scriptId: string
  scriptName: string | null
  state: "queued" | "running" | "ok" | "error" | "timeout" | "cancelled" | "dryrun"
  exitCode: number | null
  dryRun: boolean
  initiatedBy: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
}

export async function getDeviceScriptRuns(deviceId: string, limit = 20): Promise<DeviceScriptRun[]> {
  if (await mockMode()) return []
  const rows = await prisma.fl_ScriptRun.findMany({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  const scriptIds = [...new Set(rows.map((r) => r.scriptId))]
  const scripts = scriptIds.length
    ? await prisma.fl_Script.findMany({
        where: { id: { in: scriptIds } },
        select: { id: true, name: true },
      })
    : []
  const nameById = new Map(scripts.map((s) => [s.id, s.name]))
  return rows.map((r) => ({
    id: r.id,
    scriptId: r.scriptId,
    scriptName: nameById.get(r.scriptId) ?? null,
    state: (r.state as DeviceScriptRun["state"]) ?? "queued",
    exitCode: r.exitCode,
    dryRun: r.dryRun,
    initiatedBy: r.initiatedBy,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    createdAt: r.createdAt,
  }))
}
