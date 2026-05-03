import { NextRequest, NextResponse } from "next/server"
import { dispatchPatchScanAll } from "@/lib/patch-deploy"

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

export async function GET(req: NextRequest) {
  return run(req)
}
export async function POST(req: NextRequest) {
  return run(req)
}

async function run(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? ""
  const expected = `Bearer ${process.env.FLEETHUB_AGENT_SECRET ?? ""}`
  if (!process.env.FLEETHUB_AGENT_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const results = await dispatchPatchScanAll()
  return NextResponse.json({
    dispatched: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  })
}
