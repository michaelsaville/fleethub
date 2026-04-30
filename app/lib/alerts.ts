import "server-only"
import { prisma } from "@/lib/prisma"
import { mockMode } from "@/lib/devices"
import { getMockAlertsAll, getMockDevices } from "@/lib/mock-fleet"
import type { ActivityItem } from "@/components/ActivityFeed"
import { relativeLastSeen } from "./devices-time"

/**
 * Read-side abstraction over `Fl_Alert`. Like lib/devices.ts, falls
 * back to seed data when the live table is empty so the /alerts UI
 * is meaningful before any agent has fired a real alert.
 *
 * Mutating helpers live in app/(protected)/alerts/actions.ts so the
 * client component can import them without dragging server-only
 * imports across the boundary.
 */

export type AlertSeverity = "info" | "warn" | "critical"
export type AlertState = "open" | "ack" | "resolved"

export interface AlertRow {
  id: string
  deviceId: string | null
  deviceHostname: string | null
  clientName: string | null
  kind: string
  severity: AlertSeverity
  title: string
  detail: string | null
  state: AlertState
  ackedBy: string | null
  ackedAt: Date | null
  resolvedAt: Date | null
  createdAt: Date
  isMock: boolean
}

export interface AlertFilters {
  severity?: AlertSeverity
  state?: AlertState | "all"
  client?: string
  deviceId?: string
  q?: string
}

export interface AlertListResult {
  rows: AlertRow[]
  totalBeforeFilter: number
  isMock: boolean
  totals: {
    open: number
    ack: number
    resolved: number
    critical: number
    warn: number
    info: number
  }
  facets: {
    clients: Array<{ name: string; count: number }>
  }
}

export async function listAlerts(filters: AlertFilters = {}): Promise<AlertListResult> {
  const isMock = await mockMode()
  let rows: AlertRow[]

  if (isMock) {
    const devices = getMockDevices()
    const hostnameById = new Map(devices.map((d) => [d.id, d.hostname]))
    rows = getMockAlertsAll().map((a) => ({
      id: a.id,
      deviceId: a.deviceId,
      deviceHostname: hostnameById.get(a.deviceId) ?? null,
      clientName: a.clientName,
      kind: a.kind,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      state: a.state,
      ackedBy: null,
      ackedAt: null,
      resolvedAt: null,
      createdAt: a.createdAt,
      isMock: true,
    }))
  } else {
    const dbRows = await prisma.fl_Alert.findMany({
      orderBy: [{ state: "asc" }, { createdAt: "desc" }],
      take: 500,
    })
    const deviceIds = [...new Set(dbRows.map((r) => r.deviceId).filter((x): x is string => !!x))]
    const devices = deviceIds.length
      ? await prisma.fl_Device.findMany({
          where: { id: { in: deviceIds } },
          select: { id: true, hostname: true },
        })
      : []
    const hostnameById = new Map(devices.map((d) => [d.id, d.hostname]))
    rows = dbRows.map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      deviceHostname: r.deviceId ? hostnameById.get(r.deviceId) ?? null : null,
      clientName: r.clientName,
      kind: r.kind,
      severity: (r.severity as AlertSeverity) ?? "info",
      title: r.title,
      detail: r.detailJson,
      state: (r.state as AlertState) ?? "open",
      ackedBy: r.ackedBy,
      ackedAt: r.ackedAt,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
      isMock: false,
    }))
  }

  const totalBeforeFilter = rows.length
  const totals = {
    open:     rows.filter((r) => r.state === "open").length,
    ack:      rows.filter((r) => r.state === "ack").length,
    resolved: rows.filter((r) => r.state === "resolved").length,
    critical: rows.filter((r) => r.severity === "critical").length,
    warn:     rows.filter((r) => r.severity === "warn").length,
    info:     rows.filter((r) => r.severity === "info").length,
  }
  const facets = computeFacets(rows)

  if (filters.q) {
    const needle = filters.q.toLowerCase()
    rows = rows.filter((r) =>
      r.title.toLowerCase().includes(needle) ||
      r.kind.toLowerCase().includes(needle) ||
      (r.clientName ?? "").toLowerCase().includes(needle) ||
      (r.deviceHostname ?? "").toLowerCase().includes(needle),
    )
  }
  if (filters.severity) rows = rows.filter((r) => r.severity === filters.severity)
  if (filters.state && filters.state !== "all") rows = rows.filter((r) => r.state === filters.state)
  if (filters.client) rows = rows.filter((r) => r.clientName === filters.client)
  if (filters.deviceId) rows = rows.filter((r) => r.deviceId === filters.deviceId)

  return { rows, totalBeforeFilter, isMock, totals, facets }
}

export async function getAlert(id: string): Promise<AlertRow | null> {
  const list = await listAlerts({ state: "all" })
  return list.rows.find((r) => r.id === id) ?? null
}

export async function getAlertActivity(alertId: string, limit = 20): Promise<ActivityItem[]> {
  if (await mockMode()) {
    return [
      {
        id: `${alertId}-fired`,
        ts: relativeLastSeen(new Date()),
        actor: null,
        action: "alert.fire",
        outcome: "pending",
        detail: "Synthesized — seed alert, no audit trail yet.",
      },
    ]
  }
  const rows = await prisma.fl_AuditLog.findMany({
    where: {
      OR: [
        { detailJson: { contains: alertId } },
        { action: { contains: alertId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return rows.map((r) => ({
    id: r.id,
    ts: relativeLastSeen(r.createdAt),
    actor: r.actorEmail,
    action: r.action,
    outcome: r.outcome as "ok" | "error" | "pending",
    detail: r.detailJson ?? undefined,
  }))
}

function computeFacets(rows: AlertRow[]): AlertListResult["facets"] {
  const clients = new Map<string, number>()
  for (const r of rows) {
    if (!r.clientName) continue
    clients.set(r.clientName, (clients.get(r.clientName) ?? 0) + 1)
  }
  const sortedClients = [...clients.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }))
  return { clients: sortedClients }
}
