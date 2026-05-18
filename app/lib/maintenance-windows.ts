import "server-only"
import { prisma } from "@/lib/prisma"
import { nextFireTime } from "@/lib/cron-fire-eval"
import { CronExpressionParser } from "cron-parser"

// Phase 12 WS-B — recurring tenant maintenance windows.
//
// Each Fl_MaintenanceWindow has an RRULE-style cron string + a
// durationMin. The eval cron (every 1m) determines whether `now`
// is INSIDE the window (between the most recent fire-time and
// fire-time + durationMin); if yes, devices in scope are flipped
// to maintenanceMode=true (reuses Phase 3 plumbing — no new alert
// suppression path). When `now` is past the window's nextEnd, the
// devices flip back.

export interface MaintenanceWindowScope {
  deviceTags?: string[]
  deviceGroupId?: string
}

export function parseScope(json: string | null): MaintenanceWindowScope {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    const x = parsed as Record<string, unknown>
    return {
      deviceTags: Array.isArray(x.deviceTags)
        ? (x.deviceTags as unknown[]).filter((s): s is string => typeof s === "string")
        : undefined,
      deviceGroupId: typeof x.deviceGroupId === "string" ? x.deviceGroupId : undefined,
    }
  } catch {
    return {}
  }
}

export function parseSuppressKinds(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return (parsed as unknown[]).filter((s): s is string => typeof s === "string")
  } catch {
    return []
  }
}

/** Compute prev-fire + next-end for a window relative to `now`.
 *  Uses cron-parser directly; we only call this from the cron + the
 *  editor, so it doesn't go through cron-fire-eval's higher-level
 *  due/skip logic (we need both bounds, not just due-yes/due-no). */
export function windowBoundsAt(
  cron: string,
  durationMin: number,
  timezone: string | null,
  now: Date,
): { prevStart: Date | null; prevEnd: Date | null; isActive: boolean } {
  try {
    const it = CronExpressionParser.parse(cron, {
      tz: timezone || "UTC",
      currentDate: now,
    })
    const prevStart = it.prev().toDate()
    const prevEnd = new Date(prevStart.getTime() + durationMin * 60_000)
    const isActive = now >= prevStart && now < prevEnd
    return { prevStart, prevEnd, isActive }
  } catch {
    return { prevStart: null, prevEnd: null, isActive: false }
  }
}

/** Used by the editor to show "next window: …". */
export function nextWindowStart(
  cron: string,
  timezone: string | null,
  now: Date = new Date(),
): Date | null {
  return nextFireTime(cron, timezone, now)
}

/** Resolve the device ids that this window's scope targets, scoped
 *  to a tenant. v1 supports either `deviceGroupId` OR `deviceTags`,
 *  not both — if both are present, group wins. Empty scope = every
 *  active device in the tenant. */
export async function resolveScopeDeviceIds(
  tenantName: string,
  scope: MaintenanceWindowScope,
): Promise<string[]> {
  if (scope.deviceGroupId) {
    const grp = await prisma.fl_DeviceGroup.findUnique({
      where: { id: scope.deviceGroupId },
      select: { tenantName: true, pinnedDeviceIdsJson: true, rql: true },
    })
    if (!grp || grp.tenantName !== tenantName) return []
    if (grp.pinnedDeviceIdsJson) {
      try {
        const ids = JSON.parse(grp.pinnedDeviceIdsJson) as unknown
        if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === "string")
      } catch {
        return []
      }
    }
    // rql resolution is out of scope for v1 maintenance windows —
    // operator uses pinned ids for the maintenance use case. (Phase
    // 13 may revisit if asked.)
    return []
  }
  if (scope.deviceTags && scope.deviceTags.length > 0) {
    // Tags resolve via Fl_Device.role today (single-tag MVP). When
    // the device-tags primitive lands as a real list column (future
    // Phase 13+ idea), this widens.
    const devices = await prisma.fl_Device.findMany({
      where: {
        clientName: tenantName,
        isActive: true,
        role: { in: scope.deviceTags },
      },
      select: { id: true },
    })
    return devices.map((d) => d.id)
  }
  // No scope = every active device in tenant.
  const devices = await prisma.fl_Device.findMany({
    where: { clientName: tenantName, isActive: true },
    select: { id: true },
  })
  return devices.map((d) => d.id)
}
