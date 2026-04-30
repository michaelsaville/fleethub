import "server-only"
import { listAlerts } from "@/lib/alerts"
import { listDevices, mockMode } from "@/lib/devices"
import type { ActivityItem } from "@/components/ActivityFeed"
import { synthesizeFleetActivity } from "@/lib/mock-fleet"
import { prisma } from "@/lib/prisma"
import { relativeLastSeen } from "./devices-time"

/**
 * Per-client fleet rollup. FleetHub doesn't own a clients table —
 * client names are cross-app keys matching `TH_Client.name`. So this
 * lib aggregates Fl_Device + Fl_Alert by clientName at read time, no
 * dedicated table needed.
 *
 * Mock-aware via the same mockMode() the rest of the app uses.
 */

export interface ClientRow {
  name: string
  deviceCount: number
  onlineCount: number
  offlineCount: number
  openAlerts: number
  criticalAlerts: number
  hostsBehindPatch: number
  oldestPurchase: string | null
  newestActivity: Date | null
  isMock: boolean
}

export interface ClientDetail extends ClientRow {
  devicesById: Map<string, { hostname: string; isOnline: boolean }>
}

export async function listClients(): Promise<ClientRow[]> {
  const isMock = await mockMode()
  const { rows: devices } = await listDevices()
  const { rows: alerts } = await listAlerts({ state: "all" })

  const byClient = new Map<string, ClientRow>()
  for (const d of devices) {
    const r = byClient.get(d.clientName) ?? blankRow(d.clientName, isMock)
    r.deviceCount++
    if (d.isOnline) r.onlineCount++
    else r.offlineCount++
    if ((d.inventory?.patches.pending ?? 0) > 0) r.hostsBehindPatch++
    if (d.inventory?.hardware.purchaseDate) {
      if (!r.oldestPurchase || d.inventory.hardware.purchaseDate < r.oldestPurchase) {
        r.oldestPurchase = d.inventory.hardware.purchaseDate
      }
    }
    if (d.lastSeenAt && (!r.newestActivity || d.lastSeenAt > r.newestActivity)) {
      r.newestActivity = d.lastSeenAt
    }
    byClient.set(d.clientName, r)
  }
  for (const a of alerts) {
    if (!a.clientName) continue
    const r = byClient.get(a.clientName)
    if (!r) continue
    if (a.state === "open") {
      r.openAlerts++
      if (a.severity === "critical") r.criticalAlerts++
    }
  }

  return [...byClient.values()].sort((a, b) =>
    b.deviceCount - a.deviceCount || a.name.localeCompare(b.name),
  )
}

export async function getClient(name: string): Promise<ClientDetail | null> {
  const all = await listClients()
  const summary = all.find((c) => c.name === name)
  if (!summary) return null
  const { rows: devices } = await listDevices({ client: name })
  return {
    ...summary,
    devicesById: new Map(devices.map((d) => [d.id, { hostname: d.hostname, isOnline: d.isOnline }])),
  }
}

export async function getClientActivity(name: string, limit = 30): Promise<ActivityItem[]> {
  if (await mockMode()) {
    // Filter the synthesized fleet feed to entries whose detail mentions
    // this client. Cheap and good enough for the demo.
    const all = synthesizeFleetActivity(200)
    return all.filter((it) => (it.detail ?? "").includes(name)).slice(0, limit)
  }
  const rows = await prisma.fl_AuditLog.findMany({
    where: { clientName: name },
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

function blankRow(name: string, isMock: boolean): ClientRow {
  return {
    name,
    deviceCount: 0,
    onlineCount: 0,
    offlineCount: 0,
    openAlerts: 0,
    criticalAlerts: 0,
    hostsBehindPatch: 0,
    oldestPurchase: null,
    newestActivity: null,
    isMock,
  }
}
