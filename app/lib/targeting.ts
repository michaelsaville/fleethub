import "server-only"
import { prisma } from "@/lib/prisma"

// Phase 9 WS-C §5.1 — single resolver that maps an Fl_DeviceGroup
// to the current device set. v1 ships pinned-list resolution
// in-line; RQL semantics deferred to v1.5 (the design schema
// already has the column).

export interface ResolvedDevice {
  id: string
  hostname: string
  clientName: string
  os: string | null
}

export async function resolveGroupTargets(groupId: string): Promise<ResolvedDevice[]> {
  const group = await prisma.fl_DeviceGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      tenantName: true,
      rql: true,
      pinnedDeviceIdsJson: true,
    },
  })
  if (!group) return []

  // Pinned ids — strict array of Fl_Device.id strings.
  let pinnedIds: string[] = []
  if (group.pinnedDeviceIdsJson) {
    try {
      const parsed = JSON.parse(group.pinnedDeviceIdsJson)
      if (Array.isArray(parsed)) pinnedIds = parsed.filter((s): s is string => typeof s === "string")
    } catch {
      // ignore — treat as no pins
    }
  }

  // RQL parser is v1.5; for v1 we resolve the tenant + active filter
  // as a best-effort fallback when rql is set. This gives operators
  // "all active devices in tenant X" until the parser lands.
  let rqlIds: string[] = []
  if (group.rql && group.rql.trim()) {
    const rqlDevices = await prisma.fl_Device.findMany({
      where: { clientName: group.tenantName, isActive: true },
      select: { id: true },
    })
    rqlIds = rqlDevices.map((d) => d.id)
  }

  const allIds = Array.from(new Set([...pinnedIds, ...rqlIds]))
  if (allIds.length === 0) return []

  const devices = await prisma.fl_Device.findMany({
    where: { id: { in: allIds }, isActive: true },
    select: { id: true, hostname: true, clientName: true, os: true },
    orderBy: [{ clientName: "asc" }, { hostname: "asc" }],
  })
  return devices
}

/// Count-only helper for list previews.
export async function countGroupTargets(groupId: string): Promise<number> {
  const targets = await resolveGroupTargets(groupId)
  return targets.length
}
