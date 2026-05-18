import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/with-cron-auth"
import { writeAudit } from "@/lib/audit"
import {
  parseScope,
  parseSuppressKinds,
  windowBoundsAt,
  resolveScopeDeviceIds,
  nextWindowStart,
} from "@/lib/maintenance-windows"

// Phase 12 WS-B.2 — maintenance window evaluator.
//
// Cadence: 1 minute. Per active Fl_MaintenanceWindow:
//   - Compute prevStart / prevEnd from cron + durationMin.
//   - If now ∈ [prevStart, prevEnd) AND lastFiredAt != prevStart:
//       Flip resolved devices to maintenanceMode=true.
//       Mark active alerts of matching kinds suppressed.
//       Write audit row maintenance-window.entered.
//       Set lastFiredAt = prevStart.
//   - If we previously fired this window AND now >= prevEnd:
//       Flip devices back to maintenanceMode=false.
//       (Suppressed alerts stay suppressed — operator can ack/
//       resolve them; we don't auto-restore to open.)
//       Write audit row maintenance-window.exited.
//
// Reuses Phase 3's maintenance plumbing (no new suppression code
// path — Fl_Device.maintenanceMode + Fl_Alert.state='suppressed'
// already drive every alert dispatcher's filtering).

export const dynamic = "force-dynamic"
export const maxDuration = 60

export const POST = withCronAuth(async (_req: NextRequest) => {
  const now = new Date()
  const windows = await prisma.fl_MaintenanceWindow.findMany({
    where: { isActive: true },
  })
  const entered: string[] = []
  const exited: string[] = []
  for (const w of windows) {
    const bounds = windowBoundsAt(w.cron, w.durationMin, null, now)
    if (!bounds.prevStart || !bounds.prevEnd) continue
    const insideWindow = bounds.isActive
    const previouslyFired =
      w.lastFiredAt && w.lastFiredAt.getTime() === bounds.prevStart.getTime()
    const next = nextWindowStart(w.cron, null, now)

    if (insideWindow && !previouslyFired) {
      // Window just entered.
      const scope = parseScope(w.scopeJson)
      const suppress = parseSuppressKinds(w.suppressAlertKindsJson)
      const deviceIds = await resolveScopeDeviceIds(w.tenantName, scope)
      // Prisma typing for $transaction's sequential array is fussy;
      // use the function-form by collecting promises with a wide
      // type. We'll await each in sequence which preserves atomicity
      // at the per-update level (good enough — this is a 1m cron,
      // not a hot path).
      const ops: Promise<unknown>[] = []
      if (deviceIds.length > 0) {
        ops.push(
          prisma.fl_Device.updateMany({
            where: { id: { in: deviceIds }, isActive: true },
            data: {
              maintenanceMode: true,
              maintenanceUntil: bounds.prevEnd,
              maintenanceReason: `Window: ${w.name}`,
              maintenanceSetBy: "maintenance-window-eval",
            },
          }),
        )
      }
      if (suppress.length > 0 && deviceIds.length > 0) {
        ops.push(
          prisma.fl_Alert.updateMany({
            where: {
              deviceId: { in: deviceIds },
              kind: { in: suppress },
              state: "open",
            },
            data: { state: "suppressed" },
          }),
        )
      }
      ops.push(
        prisma.fl_MaintenanceWindow.update({
          where: { id: w.id },
          data: { lastFiredAt: bounds.prevStart, nextStart: next, nextEnd: bounds.prevEnd },
        }),
      )
      // Run sequentially. $transaction's array form has tight typing
      // that disagrees with our Promise<unknown>[] collection; this
      // path is a 1m cron, not a hot loop, and per-update atomicity
      // is sufficient (full-transactional would only matter if a
      // device flip and the lastFiredAt write needed to be all-or-
      // nothing; they don't — re-run of an already-fired window is
      // a no-op via the previouslyFired check).
      for (const op of ops) {
        await op
      }
      await writeAudit({
        clientName: w.tenantName,
        action: "maintenance-window.entered",
        outcome: "ok",
        detail: {
          windowId: w.id,
          name: w.name,
          devices: deviceIds.length,
          suppressedKinds: suppress,
        },
      }).catch(() => {})
      entered.push(w.id)
    } else if (!insideWindow && previouslyFired) {
      // Window just exited. Flip devices back.
      const scope = parseScope(w.scopeJson)
      const deviceIds = await resolveScopeDeviceIds(w.tenantName, scope)
      if (deviceIds.length > 0) {
        await prisma.fl_Device.updateMany({
          where: {
            id: { in: deviceIds },
            maintenanceSetBy: "maintenance-window-eval",
          },
          data: {
            maintenanceMode: false,
            maintenanceUntil: null,
            maintenanceReason: null,
            maintenanceSetBy: null,
          },
        })
      }
      await prisma.fl_MaintenanceWindow.update({
        where: { id: w.id },
        data: { nextStart: next, nextEnd: null },
      })
      await writeAudit({
        clientName: w.tenantName,
        action: "maintenance-window.exited",
        outcome: "ok",
        detail: { windowId: w.id, name: w.name, devices: deviceIds.length },
      }).catch(() => {})
      exited.push(w.id)
    } else if (next && (!w.nextStart || w.nextStart.getTime() !== next.getTime())) {
      // Out-of-window steady-state: keep nextStart up-to-date for the UI.
      await prisma.fl_MaintenanceWindow.update({
        where: { id: w.id },
        data: { nextStart: next, nextEnd: null },
      })
    }
  }
  return NextResponse.json({
    ok: true,
    windowsScanned: windows.length,
    entered,
    exited,
  })
})
