import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { tripRunbook } from "@/lib/runbook-evaluator"
import { evaluatePredicate } from "@/lib/runbook-predicate"
import { runScript } from "@/lib/script-commands"
import { withCronAuth } from "@/lib/with-cron-auth"

// Phase 7 Workstream B step 4 — runbook watcher cron.
//
// Polls Fl_RunbookFire rows in state="running" and looks up the
// linked Fl_ScriptRun. If the run has reached a terminal state,
// the fire is reconciled (state="succeeded" or "failed"). On
// failure, the runbook's consecutive-failure counter is recomputed
// from history; if it equals or exceeds maxConsecutiveFailures,
// tripRunbook() flips isTripped + emits a routable
// runbook.tripped alert.
//
// Cadence: every 1 minute alongside the existing fire-cron +
// alert-escalator. Bearer-auth via FLEETHUB_AGENT_SECRET.

export const dynamic = "force-dynamic"
export const maxDuration = 120

const BATCH = 200
const SCRIPT_TERMINAL_STATES = new Set(["ok", "error", "timeout", "cancelled", "rejected"])

const handler = withCronAuth<NextRequest>(async (req) => {

  const now = new Date()
  const pending = await prisma.fl_RunbookFire.findMany({
    where: {
      state: { in: ["dry-run", "running"] },
      OR: [{ dryRunScriptRunId: { not: null } }, { realScriptRunId: { not: null } }],
    },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      runbookId: true,
      deviceId: true,
      state: true,
      dryRunScriptRunId: true,
      realScriptRunId: true,
    },
  })

  let succeeded = 0
  let failed = 0
  let predicatePassed = 0
  let predicateFailed = 0
  let tripped = 0
  const errors: string[] = []
  // Group by runbookId so per-runbook trip check runs at most once
  // per tick regardless of how many fires landed in this batch.
  const runbooksToCheck = new Set<string>()

  for (const f of pending) {
    try {
      if (f.state === "dry-run") {
        const result = await advanceDryRun(f)
        if (result === "advanced-to-running") predicatePassed++
        else if (result === "predicate-failed") predicateFailed++
        else if (result === "dry-failed") {
          failed++
          runbooksToCheck.add(f.runbookId)
        }
        continue
      }
      // state === "running"
      const runRow = await prisma.fl_ScriptRun.findUnique({
        where: { id: f.realScriptRunId! },
        select: { state: true, exitCode: true, finishedAt: true },
      })
      if (!runRow || !SCRIPT_TERMINAL_STATES.has(runRow.state)) continue

      const succeededThisFire = runRow.state === "ok" && (runRow.exitCode ?? 0) === 0
      await prisma.fl_RunbookFire.update({
        where: { id: f.id },
        data: {
          state: succeededThisFire ? "succeeded" : "failed",
          completedAt: runRow.finishedAt ?? new Date(),
          failureReason: succeededThisFire
            ? null
            : `script run ${f.realScriptRunId} → state=${runRow.state}, exit=${runRow.exitCode ?? "—"}`,
        },
      })
      if (succeededThisFire) succeeded++
      else {
        failed++
        runbooksToCheck.add(f.runbookId)
      }
    } catch (err) {
      errors.push(`${f.id}: ${(err as Error).message}`)
    }
  }

  // Consecutive-failure check per runbook.
  for (const runbookId of runbooksToCheck) {
    try {
      const tripFromTrend = await checkConsecutiveFailures(runbookId)
      if (tripFromTrend) tripped++
    } catch (err) {
      errors.push(`runbook ${runbookId} trip check: ${(err as Error).message}`)
    }
  }

  await writeAudit({
    action: "runbook.watcher.tick",
    outcome: errors.length === 0 ? "ok" : "error",
    detail: {
      examined: pending.length,
      succeeded,
      failed,
      predicatePassed,
      predicateFailed,
      tripped,
      errors: errors.length,
    },
  }).catch(() => undefined)

  return NextResponse.json({
    sweptAt: now.toISOString(),
    examined: pending.length,
    succeeded,
    failed,
    predicatePassed,
    predicateFailed,
    tripped,
    errors,
  })
})

type DryRunOutcome = "advanced-to-running" | "predicate-failed" | "dry-failed" | "still-waiting"

/**
 * Advance an Fl_RunbookFire that's in state="dry-run" once its
 * linked Fl_ScriptRun reaches a terminal state. Three branches:
 *  - dry-run errored → fire fails, returns "dry-failed".
 *  - dry-run ok + predicate passes → enqueue real run via
 *    runScript(); transition to state="running" with realScriptRunId.
 *  - dry-run ok + predicate fails → terminal state="predicate-failed".
 */
async function advanceDryRun(f: {
  id: string
  runbookId: string
  deviceId: string
  dryRunScriptRunId: string | null
  realScriptRunId: string | null
}): Promise<DryRunOutcome> {
  if (!f.dryRunScriptRunId) return "still-waiting"
  const dryRun = await prisma.fl_ScriptRun.findUnique({
    where: { id: f.dryRunScriptRunId },
    select: { state: true, exitCode: true, output: true, finishedAt: true },
  })
  if (!dryRun || !SCRIPT_TERMINAL_STATES.has(dryRun.state)) return "still-waiting"

  if (dryRun.state !== "ok") {
    await prisma.fl_RunbookFire.update({
      where: { id: f.id },
      data: {
        state: "failed",
        completedAt: dryRun.finishedAt ?? new Date(),
        predicateOutcome: "skip",
        failureReason: `dry-run failed (state=${dryRun.state}, exit=${dryRun.exitCode ?? "—"})`,
      },
    })
    return "dry-failed"
  }

  // Dry-run succeeded — evaluate the predicate.
  const runbook = await prisma.fl_Runbook.findUnique({
    where: { id: f.runbookId },
    select: { scriptId: true, dryRunPredicateJson: true, isActive: true, isTripped: true },
  })
  if (!runbook || !runbook.isActive || runbook.isTripped) {
    await prisma.fl_RunbookFire.update({
      where: { id: f.id },
      data: {
        state: "predicate-failed",
        completedAt: new Date(),
        predicateOutcome: "skip",
        failureReason: !runbook ? "runbook deleted" : runbook.isTripped ? "runbook tripped between dry-run and decision" : "runbook disabled between dry-run and decision",
      },
    })
    return "predicate-failed"
  }

  const result = evaluatePredicate(runbook.dryRunPredicateJson, {
    state: dryRun.state,
    exitCode: dryRun.exitCode,
    output: dryRun.output,
  })

  if (!result.pass) {
    await prisma.fl_RunbookFire.update({
      where: { id: f.id },
      data: {
        state: "predicate-failed",
        completedAt: new Date(),
        predicateOutcome: "fail",
        failureReason: result.reason,
      },
    })
    return "predicate-failed"
  }

  // Predicate passed — enqueue the real run.
  try {
    const real = await runScript({
      scriptId: runbook.scriptId,
      deviceId: f.deviceId,
      initiatedBy: `runbook:${f.runbookId}`,
      dryRun: false,
    })
    await prisma.fl_RunbookFire.update({
      where: { id: f.id },
      data: {
        state: "running",
        predicateOutcome: "pass",
        realScriptRunId: real.id,
      },
    })
    return "advanced-to-running"
  } catch (err) {
    await prisma.fl_RunbookFire.update({
      where: { id: f.id },
      data: {
        state: "failed",
        completedAt: new Date(),
        predicateOutcome: "pass",
        failureReason: `real run enqueue failed: ${(err as Error).message.slice(0, 300)}`,
      },
    })
    return "dry-failed"
  }
}

/**
 * Recompute consecutive failures from history. The most recent
 * non-skipped fires walked backwards: count until we hit a
 * succeeded or the threshold. Honors the runbook's own
 * maxConsecutiveFailures.
 *
 * Returns true if the runbook was tripped on this call.
 */
async function checkConsecutiveFailures(runbookId: string): Promise<boolean> {
  const rb = await prisma.fl_Runbook.findUnique({
    where: { id: runbookId },
    select: { name: true, isTripped: true, maxConsecutiveFailures: true },
  })
  if (!rb || rb.isTripped) return false

  // Walk recent terminal-state fires in reverse chronological
  // order. Skip the skipped-* states (they shouldn't count as
  // either success or failure for the consecutive-fail trend).
  const recent = await prisma.fl_RunbookFire.findMany({
    where: {
      runbookId,
      state: { in: ["succeeded", "failed"] },
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(rb.maxConsecutiveFailures + 1, 10),
    select: { state: true, deviceId: true },
  })

  let streak = 0
  for (const f of recent) {
    if (f.state === "failed") streak++
    else break
  }
  if (streak < rb.maxConsecutiveFailures) return false

  // Trip. Use the most recent failing fire's device/client for the
  // emitted alert (so the trip-alert routes to the affected
  // tenant's notification channels).
  const lastFailing = recent.find((f) => f.state === "failed")
  const device = lastFailing
    ? await prisma.fl_Device.findUnique({
        where: { id: lastFailing.deviceId },
        select: { clientName: true },
      })
    : null

  await tripRunbook({
    runbookId,
    runbookName: rb.name,
    reason: `auto-trip: ${streak} consecutive failures (threshold ${rb.maxConsecutiveFailures})`,
    deviceId: lastFailing?.deviceId ?? null,
    clientName: device?.clientName ?? null,
  })
  return true
}

export const GET = handler
export const POST = handler
