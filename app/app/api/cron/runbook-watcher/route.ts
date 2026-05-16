import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { tripRunbook } from "@/lib/runbook-evaluator"

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

export async function GET(req: NextRequest) {
  return run(req)
}
export async function POST(req: NextRequest) {
  return run(req)
}

async function run(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? ""
  const secret = process.env.FLEETHUB_AGENT_SECRET ?? ""
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const running = await prisma.fl_RunbookFire.findMany({
    where: { state: "running", realScriptRunId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      runbookId: true,
      deviceId: true,
      realScriptRunId: true,
    },
  })

  let succeeded = 0
  let failed = 0
  let tripped = 0
  const errors: string[] = []
  // Group by runbookId so per-runbook trip check runs at most once
  // per tick regardless of how many fires landed in this batch.
  const runbooksToCheck = new Set<string>()

  for (const f of running) {
    try {
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
      examined: running.length,
      succeeded,
      failed,
      tripped,
      errors: errors.length,
    },
  }).catch(() => undefined)

  return NextResponse.json({
    sweptAt: now.toISOString(),
    examined: running.length,
    succeeded,
    failed,
    tripped,
    errors,
  })
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
