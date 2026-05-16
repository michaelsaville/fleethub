import { NextRequest, NextResponse } from "next/server"
import { getSessionContext } from "@/lib/authz"
import { markAlertAcked } from "@/lib/alert-dispatch"
import { verifyAckToken } from "@/lib/alert-ack-token"

// Phase 7 Workstream A step 9 — signed-token ack URL embedded in
// every Slack/Teams/email notification. Holding the URL = auth;
// the HMAC keeps random alert-id guesses from working from
// outside.
//
// Two paths land here:
// 1) Logged-in operator clicks the URL → session-auth path,
//    actor = session.user.email.
// 2) Channel recipient clicks from chat/email → token-auth path,
//    actor = "via-ack-link" so the audit row still has SOMETHING
//    identifiable. Future Phase 7.5 could carry an actor token
//    embedded in the link, but that's beyond v1's "anyone in the
//    channel can ack" model.

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(req, params)
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(req, params)
}

async function handle(req: NextRequest, params: Promise<{ id: string }>) {
  const { id } = await params
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? ""

  let actor: string
  const ctx = await getSessionContext()
  if (ctx) {
    actor = ctx.email
  } else if (token && verifyAckToken(id, token)) {
    actor = "via-ack-link"
  } else {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const { alreadyAcked } = await markAlertAcked(id, actor)
    // Browser GETs (most likely from chat clients) want HTML; API
    // POSTs may want JSON. Heuristic: Accept header.
    const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html")
    if (wantsHtml) {
      return htmlConfirm(id, alreadyAcked, actor)
    }
    return NextResponse.json({ ok: true, alertId: id, actor, alreadyAcked })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 })
  }
}

function htmlConfirm(alertId: string, alreadyAcked: boolean, actor: string): NextResponse {
  const base = (process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com").replace(/\/$/, "")
  const link = `${base}/alerts/${alertId}`
  const title = alreadyAcked ? "Alert already acked" : "Alert acked"
  const subtitle = alreadyAcked
    ? "Someone else got to it first. No state change."
    : `Acked by ${esc(actor)}. The escalation chain has stopped.`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Helvetica,Arial,sans-serif;color:#0F172A;font-size:14px;line-height:1.5;margin:0;padding:40px;background:#fff;">
<div style="max-width:480px;margin:0 auto;text-align:center;">
<h1 style="font-size:22px;margin:0 0 10px;">${esc(title)}</h1>
<p style="color:#64748B;margin:0 0 24px;">${subtitle}</p>
<a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#F97316;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Open alert in FleetHub</a>
</div></body></html>`
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
