import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { matchesAlert } from "@/lib/alert-dispatch"
import type { Fl_Alert } from "@prisma/client"

// Phase 7 Workstream B step 1 — runbook evaluator.
//
// Called from writeAlert() AFTER Workstream A's dispatch. For
// each active, non-tripped runbook whose matchJson covers the
// alert, creates an Fl_RunbookFire row in state="pending" with
// scheduledAt = now + runbook.graceMin. The fire-cron at
// /api/cron/runbook-fire runs the script when scheduledAt
// elapses (and skips if the alert has already been acked).
//
// Step 1 doesn't implement dry-run-first (step 5) or the
// circuit breaker (step 4) — those slots are reserved in the
// schema so they can land without breaking row compatibility.

interface MatchPredicate {
  severity?: string | string[]
  kindLike?: string
}

export async function evaluateRunbooksForAlert(alert: Fl_Alert): Promise<void> {
  if (!alert.deviceId) return  // runbooks always target a specific device
  // Don't re-enter on our own trip alerts — would otherwise create
  // a meta-loop where a `severity:["warn"]` runbook could fire on
  // every runbook trip. Per-runbook circuit breakers would bound
  // it eventually but the right answer is to not enter the loop.
  if (alert.kind === "runbook.tripped") return

  const candidates = await prisma.fl_Runbook.findMany({
    where: { isActive: true, isTripped: false },
    select: {
      id: true,
      name: true,
      matchJson: true,
      graceMin: true,
      cooldownMin: true,
      maxFiresPerHour: true,
    },
  })

  const now = Date.now()
  for (const r of candidates) {
    let predicate: MatchPredicate
    try {
      predicate = JSON.parse(r.matchJson) as MatchPredicate
    } catch {
      continue
    }
    if (!matchesAlert(predicate, alert)) continue

    // Cooldown: any recent Fl_RunbookFire for THIS runbook on
    // (alertKind, deviceId) within cooldownMin? Skip if so. The
    // semantics deliberately ignore Fl_Alert row identity — the
    // cooldown is per (kind, device), not per alert, so flapping
    // alerts of the same kind on the same host don't keep firing
    // remediations.
    if (r.cooldownMin > 0) {
      const since = new Date(now - r.cooldownMin * 60_000)
      const recent = await prisma.fl_RunbookFire.findFirst({
        where: {
          runbookId: r.id,
          deviceId: alert.deviceId,
          alertKind: alert.kind,
          createdAt: { gte: since },
          state: { notIn: ["skipped-cooldown"] },
        },
        select: { id: true },
      })
      if (recent) {
        await prisma.fl_RunbookFire.create({
          data: {
            runbookId: r.id,
            alertId: alert.id,
            deviceId: alert.deviceId,
            alertKind: alert.kind,
            scheduledAt: new Date(now),
            state: "skipped-cooldown",
            completedAt: new Date(now),
            failureReason: `cooldown (${r.cooldownMin}m) — last fire within window`,
          },
        })
        continue
      }
    }

    // Circuit breaker — max fires per rolling hour across the fleet
    // (NOT per device). Counts non-skipped fires in the last hour;
    // if at-or-over the threshold, trip the runbook + emit a
    // skipped-tripped fire so the gap stays visible.
    const oneHourAgo = new Date(now - 60 * 60_000)
    const firesLastHour = await prisma.fl_RunbookFire.count({
      where: {
        runbookId: r.id,
        createdAt: { gte: oneHourAgo },
        state: { notIn: ["skipped-cooldown", "skipped-cleared", "skipped-tripped"] },
      },
    })
    if (firesLastHour >= r.maxFiresPerHour) {
      await tripRunbook({
        runbookId: r.id,
        runbookName: r.name,
        reason: `auto-trip: fires-per-hour threshold (${firesLastHour} >= ${r.maxFiresPerHour})`,
        deviceId: alert.deviceId,
        clientName: alert.clientName,
      })
      await prisma.fl_RunbookFire.create({
        data: {
          runbookId: r.id,
          alertId: alert.id,
          deviceId: alert.deviceId,
          alertKind: alert.kind,
          scheduledAt: new Date(now),
          state: "skipped-tripped",
          completedAt: new Date(now),
          failureReason: `rate-limit: ${firesLastHour} fires in last hour exceeded maxFiresPerHour=${r.maxFiresPerHour}`,
        },
      })
      continue
    }

    await prisma.fl_RunbookFire.create({
      data: {
        runbookId: r.id,
        alertId: alert.id,
        deviceId: alert.deviceId,
        alertKind: alert.kind,
        scheduledAt: new Date(now + r.graceMin * 60_000),
        state: "pending",
      },
    })
    await writeAudit({
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      action: "runbook.scheduled",
      outcome: "pending",
      detail: { runbookId: r.id, runbookName: r.name, alertId: alert.id, graceMin: r.graceMin },
    })
  }
}

/**
 * Mark a runbook tripped, audit the event, and emit a
 * `runbook.tripped` alert through the WS-A dispatch path so the
 * trip itself can be routed to ops. The meta-loop doesn't recurse
 * because the trip-alert's kind ("runbook.tripped") wouldn't
 * normally match any runbook's matchJson — and even if a misconfigured
 * one did, that runbook's own circuit breaker would catch it
 * within the hour.
 */
export async function tripRunbook(args: {
  runbookId: string
  runbookName: string
  reason: string
  deviceId: string | null
  clientName: string | null
}): Promise<void> {
  const existing = await prisma.fl_Runbook.findUnique({
    where: { id: args.runbookId },
    select: { isTripped: true },
  })
  if (!existing || existing.isTripped) return  // idempotent

  await prisma.fl_Runbook.update({
    where: { id: args.runbookId },
    data: {
      isTripped: true,
      trippedReason: args.reason,
      trippedAt: new Date(),
    },
  })
  await writeAudit({
    clientName: args.clientName,
    deviceId: args.deviceId,
    action: "runbook.tripped",
    outcome: "error",
    detail: { runbookId: args.runbookId, runbookName: args.runbookName, reason: args.reason },
  })

  // Emit a routable alert so ops sees the trip via their normal
  // notification channels. Dynamic import to avoid the
  // alert-dispatch ↔ runbook-evaluator circular dep.
  try {
    const { writeAlert } = await import("@/lib/alert-dispatch")
    await writeAlert({
      clientName: args.clientName ?? "fleethub",
      deviceId: args.deviceId,
      kind: "runbook.tripped",
      severity: "warn",
      title: `Runbook tripped: ${args.runbookName}`,
      detailJson: JSON.stringify({ runbookId: args.runbookId, reason: args.reason }),
    })
  } catch (err) {
    console.warn(`[runbook-trip] failed to emit alert for ${args.runbookId}:`, err)
  }
}
