import "server-only"
import { prisma } from "@/lib/prisma"
import { mockMode } from "@/lib/devices"
import { getMockAlertsAll, getMockDevices, synthesizeFleetActivity } from "@/lib/mock-fleet"
import type { ActivityItem } from "@/components/ActivityFeed"

export interface DashboardStats {
  onlineDevices: number
  totalDevices: number
  openAlerts: number
  criticalAlerts: number
  scriptsQueued: number
  clientsWithDevices: number
  // Phase 3/4 surfaces — exposed as 0 until those phases land so the
  // dashboard never lies about "23 software updates" again.
  hostsBehindPatch: number
  softwareUpdatesPending: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  if (await mockMode()) {
    const devices = getMockDevices()
    const alerts = getMockAlertsAll()
    const openAlerts = alerts.filter((a) => a.state === "open")
    const criticalAlerts = openAlerts.filter((a) => a.severity === "critical")
    const hostsBehindPatch = devices.filter((d) => (d.inventory?.patches.pending ?? 0) > 0).length
    const softwareUpdatesPending = devices.reduce((n, d) => n + (d.inventory?.patches.pending ?? 0), 0)
    return {
      onlineDevices: devices.filter((d) => d.isOnline).length,
      totalDevices: devices.length,
      openAlerts: openAlerts.length,
      criticalAlerts: criticalAlerts.length,
      scriptsQueued: 0,
      clientsWithDevices: new Set(devices.map((d) => d.clientName)).size,
      hostsBehindPatch,
      softwareUpdatesPending,
    }
  }

  const [
    onlineDevices,
    totalDevices,
    openAlerts,
    criticalAlerts,
    scriptsQueued,
    distinctClients,
  ] = await Promise.all([
    prisma.fl_Device.count({ where: { isActive: true, isOnline: true } }),
    prisma.fl_Device.count({ where: { isActive: true } }),
    prisma.fl_Alert.count({ where: { state: "open" } }),
    prisma.fl_Alert.count({ where: { state: "open", severity: "critical" } }),
    prisma.fl_ScriptRun.count({ where: { state: "queued" } }),
    prisma.fl_Device.findMany({
      where: { isActive: true },
      distinct: ["clientName"],
      select: { clientName: true },
    }),
  ])

  return {
    onlineDevices,
    totalDevices,
    openAlerts,
    criticalAlerts,
    scriptsQueued,
    clientsWithDevices: distinctClients.length,
    hostsBehindPatch: 0,
    softwareUpdatesPending: 0,
  }
}

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toISOString().slice(0, 10)
}

export async function getRecentActivity(limit = 8): Promise<ActivityItem[]> {
  if (await mockMode()) {
    return synthesizeFleetActivity(limit)
  }
  const rows = await prisma.fl_AuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return rows.map((r) => ({
    id: r.id,
    ts: relativeTime(r.createdAt),
    actor: r.actorEmail,
    action: r.action,
    outcome: r.outcome as "ok" | "error" | "pending",
    detail: detailSummary(r.detailJson, r.clientName, r.deviceId),
  }))
}

function detailSummary(
  detailJson: string | null,
  clientName: string | null,
  deviceId: string | null,
): string | undefined {
  const parts: string[] = []
  if (clientName) parts.push(clientName)
  if (deviceId) parts.push(deviceId)
  if (detailJson) {
    try {
      const parsed = JSON.parse(detailJson) as Record<string, unknown>
      const msg = typeof parsed.message === "string" ? parsed.message : null
      if (msg) parts.push(msg)
    } catch {
      // ignore — detailJson isn't guaranteed JSON
    }
  }
  return parts.length ? parts.join(" · ") : undefined
}
