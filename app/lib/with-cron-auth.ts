import "server-only"
import { NextResponse } from "next/server"

// Phase 8 Workstream C §5.4 — Bearer-auth wrapper for cron + agent
// ingest routes. Replaces the same 5-line check inlined in 13
// places (now ~14 cron routes + 2 posture ingest routes). One
// wrapper: missing/wrong header → 401; otherwise forwards.
//
// Typed against the bare `Request` so handlers that use NextRequest
// (most) and handlers that use Request directly (stale-agents) both
// compose. Returning NextResponse from the wrapper itself keeps the
// consumer's return shape uniform.
//
// Phase 11 WS-E.7 — the FLEETHUB_AGENT_SECRET fallback that Phase 9
// introduced as a one-release grace was supposed to be temporary.
// It's deleted here. ACTIVATION CHECKLIST: operators MUST rotate
// crontab to use FLEETHUB_CRON_SECRET BEFORE this commit deploys,
// or every cron route will 401 on the first run after deploy. The
// two-deploy split is in PHASE-11-DESIGN.md §11 step 7.

export type CronHandler<Req extends Request = Request> = (
  req: Req,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<NextResponse | Response>

export function withCronAuth<Req extends Request = Request>(
  handler: CronHandler<Req>,
): (req: Req, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse | Response> {
  return async function (req, ctx) {
    const cronSecret = process.env.FLEETHUB_CRON_SECRET ?? ""
    if (cronSecret.length === 0) {
      // Configuration error rather than a 401 — surface explicitly
      // so a misconfigured deploy is obvious in the cron log.
      return NextResponse.json(
        { error: "FLEETHUB_CRON_SECRET not configured" },
        { status: 500 },
      )
    }
    const auth = req.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    return handler(req, ctx)
  }
}
