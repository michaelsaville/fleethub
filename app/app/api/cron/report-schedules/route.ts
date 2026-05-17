import { NextRequest, NextResponse } from "next/server"
import { fireDueSchedules } from "@/lib/report-schedule"
import { withCronAuth } from "@/lib/with-cron-auth"

// Bearer-gated cron worker for Fl_ReportSchedule. Per PHASE-5-DESIGN §5.
// Same FLEETHUB_AGENT_SECRET pattern as the other cron endpoints.
//
// Recommended cadence (host crontab):
//   */5 * * * *  — every 5 minutes
//   curl -H "Authorization: Bearer $FLEETHUB_AGENT_SECRET" \
//        http://localhost:3011/api/cron/report-schedules
//
// 5-minute granularity is enough — the cron expressions on schedules
// typically fire at hourly or daily boundaries. fireDueSchedules() is
// idempotent against lastFiredAt so over-firing is harmless.
//
// Long timeout because PDF render + Graph sendMail can take ~30s per
// scheduled report when many fire in the same tick.

export const maxDuration = 300
export const dynamic = "force-dynamic"

const handler = withCronAuth<NextRequest>(async (req) => {
  try {
    const result = await fireDueSchedules()
    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      fired: result.fired,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[cron/report-schedules] failed:", msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})

export const GET = handler
export const POST = handler
