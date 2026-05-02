import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// Maintenance Mode — Phase 3 device-level toggle (NinjaOne pattern).
// When set, software.* and patches.* dispatchers MUST skip this device.
// Alerts ingested from the host are tagged suppressed in their detail.
//
// "Until" semantics:
//   - null + maintenanceMode=true  → indefinite, with reason
//   - DateTime in the future       → auto-clears at that time (drained
//     by the stale-agents cron, which already runs minutely)
//   - DateTime in the past         → drained on next read; treat as off

export interface SetMaintenanceArgs {
  deviceId: string
  on: boolean
  until?: Date | null
  reason?: string | null
  setBy: string
}

export async function setMaintenance(args: SetMaintenanceArgs) {
  const device = await prisma.fl_Device.findUnique({
    where: { id: args.deviceId },
    select: { id: true, hostname: true, clientName: true, maintenanceMode: true },
  })
  if (!device) throw new Error("Device not found")

  const updated = await prisma.fl_Device.update({
    where: { id: args.deviceId },
    data: args.on
      ? {
          maintenanceMode: true,
          maintenanceUntil: args.until ?? null,
          maintenanceReason: args.reason?.trim() || null,
          maintenanceSetBy: args.setBy,
        }
      : {
          maintenanceMode: false,
          maintenanceUntil: null,
          maintenanceReason: null,
          maintenanceSetBy: null,
        },
  })

  await writeAudit({
    actorEmail: args.setBy,
    clientName: device.clientName,
    deviceId: device.id,
    action: "device.maintenance.set",
    outcome: "ok",
    detail: {
      hostname: device.hostname,
      on: args.on,
      until: args.until?.toISOString() ?? null,
      reason: args.reason ?? null,
    },
  })

  return updated
}

export async function bulkSetMaintenance(
  deviceIds: string[],
  args: Omit<SetMaintenanceArgs, "deviceId">,
) {
  const results: { id: string; ok: boolean; error?: string }[] = []
  for (const id of deviceIds) {
    try {
      await setMaintenance({ ...args, deviceId: id })
      results.push({ id, ok: true })
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}

/** Read-time clearer for expired maintenance windows. Idempotent. */
export async function drainExpiredMaintenance(): Promise<number> {
  const r = await prisma.fl_Device.updateMany({
    where: {
      maintenanceMode: true,
      maintenanceUntil: { lt: new Date(), not: null },
    },
    data: {
      maintenanceMode: false,
      maintenanceUntil: null,
      maintenanceReason: null,
      maintenanceSetBy: null,
    },
  })
  return r.count
}

/** Returns true if the device is in maintenance. Honors expired-until. */
export async function isInMaintenance(deviceId: string): Promise<boolean> {
  const d = await prisma.fl_Device.findUnique({
    where: { id: deviceId },
    select: { maintenanceMode: true, maintenanceUntil: true },
  })
  if (!d || !d.maintenanceMode) return false
  if (d.maintenanceUntil && d.maintenanceUntil < new Date()) return false
  return true
}
