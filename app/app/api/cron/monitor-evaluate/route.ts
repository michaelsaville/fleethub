import { NextRequest, NextResponse } from "next/server"
import { evaluateMonitors } from "@/lib/monitor-evaluator"
import { withCronAuth } from "@/lib/with-cron-auth"

// Phase 8 Workstream A step 1 — monitor evaluator cron.
//
// Bearer-gated with FLEETHUB_AGENT_SECRET (same scheme as the other
// cron routes: runbook-fire, alert-escalator, etc.). Cadence: every
// 1m, same crontab block as the runbook fire-cron — adding a row:
//
//   * * * * * curl -H "Authorization: Bearer $SECRET" \
//       http://localhost:3000/api/cron/monitor-evaluate
//
// Returns a small summary so an operator hitting the endpoint by
// hand can see what fired. Audit + per-fire detail live in
// Fl_MonitorFire + Fl_Alert.

export const dynamic = "force-dynamic"
export const maxDuration = 120

const handler = withCronAuth<NextRequest>(async (req) => {

  const startedAt = Date.now()
  try {
    const summary = await evaluateMonitors()
    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ...summary,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
})

export const GET = handler
export const POST = handler
