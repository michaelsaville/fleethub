import "server-only"
import { NextResponse } from "next/server"

// Phase 8 Workstream C §5.4 — Bearer-auth wrapper for cron + agent
// ingest routes. Replaces the same 5-line check inlined in 13
// places (11 cron routes + 2 posture ingest routes). One wrapper:
// missing/wrong header → 401; otherwise forwards to the handler.
//
// Typed against the bare `Request` so handlers that use NextRequest
// (most) and handlers that use Request directly (stale-agents)
// both compose. Returning NextResponse from the wrapper itself
// keeps the consumer's return shape uniform.

export type CronHandler<Req extends Request = Request> = (
  req: Req,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<NextResponse | Response>

export function withCronAuth<Req extends Request = Request>(
  handler: CronHandler<Req>,
): (req: Req, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse | Response> {
  return async function (req, ctx) {
    const secret = process.env.FLEETHUB_AGENT_SECRET ?? ""
    const auth = req.headers.get("authorization") ?? ""
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    return handler(req, ctx)
  }
}
