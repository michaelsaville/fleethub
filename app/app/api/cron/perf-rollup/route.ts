import { NextRequest, NextResponse } from "next/server"
import { runRollup } from "@/lib/perf/rollup"
import { withCronAuth } from "@/lib/with-cron-auth"

// Bearer-gated rollup cron. Same FLEETHUB_AGENT_SECRET as patches-scan +
// cve-refresh + stale-agents.
//
// Cadence (host crontab):
//   0 * * * *  — hourly tier
//   5 0 * * *  — daily tier (5min after midnight UTC, after the last hourly)
//  10 0 * * 1  — weekly tier (Monday post-midnight, after the last daily)
//
// Query string: ?tier=hour|day|week. Default = hour.
export const maxDuration = 300
export const dynamic = "force-dynamic"

const handler = withCronAuth<NextRequest>(async (req) => {
  const url = new URL(req.url)
  const tier = (url.searchParams.get("tier") ?? "hour") as "hour" | "day" | "week"
  if (!["hour", "day", "week"].includes(tier)) {
    return NextResponse.json({ error: "tier must be hour | day | week" }, { status: 400 })
  }
  const result = await runRollup(tier)
  return NextResponse.json({ tier, ...result })
})

export const GET = handler
export const POST = handler
