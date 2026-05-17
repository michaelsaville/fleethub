import { NextRequest, NextResponse } from "next/server"
import { dispatchPatchScanAll } from "@/lib/patch-deploy"
import { withCronAuth } from "@/lib/with-cron-auth"

// Cron-callable patches.scan fan-out. Bearer-gated with
// FLEETHUB_AGENT_SECRET (same as /api/cron/cve-refresh + stale-agents).
//
// Daily cadence is the right default — Microsoft Update catalog cycles
// once per Tuesday, third-party feeds publish on their own clocks, and
// scan output volume scales linearly with fleet size. Hourly is over-
// kill for v1; can flip via crontab without code change.
//
// Returns per-device dispatch result so the operator can spot agents
// that are offline / unenrolled / dispatch-failed in one read.
export const maxDuration = 600
export const dynamic = "force-dynamic"

const handler = withCronAuth<NextRequest>(async (req) => {
  const results = await dispatchPatchScanAll()
  return NextResponse.json({
    dispatched: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  })
})

export const GET = handler
export const POST = handler
