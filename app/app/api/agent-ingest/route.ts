import { NextResponse } from "next/server"
import { verifyHmac } from "@/lib/bff-hmac"
import { handleAgentEnvelope, MethodNotSupportedError } from "@/lib/agent-ingest"
import { writeAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Agent ingest endpoint. Today's caller is the WSS gateway (or, in
 * dev, scripts/synthetic-agent.mjs). The gateway terminates the WSS +
 * JSON-RPC + per-message HMAC stack from docs/AGENT-PROTOCOL.md and
 * forwards a flat HTTP envelope here. FleetHub never speaks WSS.
 *
 * Auth between gateway and FleetHub is the same sha256= scheme used by
 * the rest of the BFF surface — HMAC-SHA-256 over `${ts}.${rawBody}`
 * with FLEETHUB_AGENT_SECRET. ±5 minute clock skew window. Replay
 * dedupe across that window is the gateway's responsibility (it
 * deduplicates by JSON-RPC id before forwarding); single-instance
 * FleetHub doesn't add a second nonce store.
 *
 * Phase 10 WS-B §4.2 — every rejection path now writes an audit row.
 * Brute-force probes / replay attempts / misconfigured gateways
 * leave a trail in /audit instead of vanishing as 400/401/503.
 */
export async function POST(req: Request) {
  const secret = process.env.FLEETHUB_AGENT_SECRET
  if (!secret) {
    await safeAudit({
      action: "agent.ingest.rejected",
      outcome: "error",
      detail: { reason: "FLEETHUB_AGENT_SECRET not set" },
    })
    return NextResponse.json({ error: "ingest-not-configured" }, { status: 503 })
  }

  const rawBody = await req.text()
  const sig = req.headers.get("x-pcc2k-signature")
  const ts = req.headers.get("x-pcc2k-timestamp")
  const verified = verifyHmac(rawBody, sig, ts, secret)
  if (!verified.ok) {
    await safeAudit({
      action: "agent.ingest.rejected",
      outcome: "error",
      detail: {
        reason: verified.reason,
        hasSig: !!sig,
        hasTs: !!ts,
        bodyBytes: rawBody.length,
      },
    })
    return NextResponse.json({ error: verified.reason }, { status: verified.status })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch (e) {
    await safeAudit({
      action: "agent.ingest.rejected",
      outcome: "error",
      detail: {
        reason: "invalid-json",
        bodyBytes: rawBody.length,
        snippet: rawBody.slice(0, 200),
      },
    })
    return NextResponse.json({ error: "invalid-json" }, { status: 400 })
  }

  try {
    const result = await handleAgentEnvelope(parsed)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof MethodNotSupportedError) {
      await safeAudit({
        action: "agent.ingest.rejected",
        outcome: "error",
        detail: { reason: e.message, kind: "method-not-supported" },
      })
      return NextResponse.json({ error: e.message, code: -32601 }, { status: 400 })
    }
    const msg = e instanceof Error ? e.message : "internal"
    await safeAudit({
      action: "agent.ingest.rejected",
      outcome: "error",
      detail: { reason: msg, kind: "handler-threw" },
    })
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

/** Audit write that swallows its own errors. We never want the
 *  audit hook to mask the real status the route is returning. */
async function safeAudit(args: Parameters<typeof writeAudit>[0]) {
  try {
    await writeAudit(args)
  } catch (err) {
    console.error("[agent-ingest] audit write failed", err)
  }
}
