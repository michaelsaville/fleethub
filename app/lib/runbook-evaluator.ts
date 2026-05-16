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

  const candidates = await prisma.fl_Runbook.findMany({
    where: { isActive: true, isTripped: false },
    select: {
      id: true,
      name: true,
      matchJson: true,
      graceMin: true,
      cooldownMin: true,
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
