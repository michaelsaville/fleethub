import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runScript } from "@/lib/script-commands"

// Phase 7 Workstream B step 1 — runbook fire-cron.
//
// Polls Fl_RunbookFire rows in state="pending" with scheduledAt
// <= now. For each: re-check the alert state (skip if acked or
// resolved during the grace window), then enqueue the runbook's
// script via the Phase 2 runScript() helper. The agent transport
// from here is unchanged — the runbook just lives upstream of
// the same signed-script-only lifecycle.
//
// Bearer-gated with FLEETHUB_AGENT_SECRET. Cadence: every 1m
// alongside the alert-escalator cron.
//
// Step 5 will add the dry-run-first + predicate flow; step 4
// adds circuit-breaker checks. This step ships the basic
// "schedule → wait grace → fire" flow.

export const dynamic = "force-dynamic"
export const maxDuration = 120

const BATCH = 100

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
  const due = await prisma.fl_RunbookFire.findMany({
    where: { state: "pending", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      runbookId: true,
      alertId: true,
      deviceId: true,
    },
  })

  let fired = 0
  let skippedCleared = 0
  let errors: string[] = []

  for (const f of due) {
    try {
      // Skip if alert was acked/resolved during the grace window.
      if (f.alertId) {
        const alert = await prisma.fl_Alert.findUnique({
          where: { id: f.alertId },
          select: { state: true },
        })
        if (alert && alert.state !== "open") {
          await prisma.fl_RunbookFire.update({
            where: { id: f.id },
            data: {
              state: "skipped-cleared",
              completedAt: new Date(),
              failureReason: `alert.state=${alert.state} when grace elapsed`,
            },
          })
          skippedCleared++
          continue
        }
      }

      const runbook = await prisma.fl_Runbook.findUnique({
        where: { id: f.runbookId },
        select: {
          scriptId: true,
          isActive: true,
          isTripped: true,
          dryRunFirst: true,
          script: { select: { dryRunCapable: true } },
        },
      })
      if (!runbook || !runbook.isActive || runbook.isTripped) {
        await prisma.fl_RunbookFire.update({
          where: { id: f.id },
          data: {
            state: "skipped-tripped",
            completedAt: new Date(),
            failureReason: !runbook
              ? "runbook deleted"
              : runbook.isTripped
                ? "runbook tripped"
                : "runbook inactive",
          },
        })
        continue
      }

      // Phase 2 runScript() honors maintenance mode + dry-run gates
      // + audit chain. Runbooks pipe in here without bypassing any
      // of that. Step 5 wires the dryRunFirst flow: when the script
      // is dry-run capable AND the runbook opts in, queue a
      // dryRun=true first; the watcher (step 4 lib) evaluates the
      // predicate and enqueues the real run if it passes.
      const willDryRun = runbook.dryRunFirst && runbook.script.dryRunCapable
      const scriptRun = await runScript({
        scriptId: runbook.scriptId,
        deviceId: f.deviceId,
        initiatedBy: `runbook:${f.runbookId}`,
        dryRun: willDryRun,
      })
      if (willDryRun) {
        await prisma.fl_RunbookFire.update({
          where: { id: f.id },
          data: {
            state: "dry-run",
            dryRunScriptRunId: scriptRun.id,
          },
        })
      } else {
        await prisma.fl_RunbookFire.update({
          where: { id: f.id },
          data: {
            state: "running",
            realScriptRunId: scriptRun.id,
            predicateOutcome: runbook.dryRunFirst ? "skip" : null,
          },
        })
      }
      fired++
    } catch (err) {
      errors.push(`${f.id}: ${(err as Error).message}`)
      await prisma.fl_RunbookFire.update({
        where: { id: f.id },
        data: {
          state: "failed",
          completedAt: new Date(),
          failureReason: (err as Error).message.slice(0, 500),
        },
      })
    }
  }

  return NextResponse.json({
    sweptAt: now.toISOString(),
    examined: due.length,
    fired,
    skippedCleared,
    errors,
  })
}
