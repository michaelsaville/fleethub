import { NextResponse } from "next/server"
import { verifyHmac } from "@/lib/bff-hmac"
import { handleAgentEnvelope, MethodNotSupportedError } from "@/lib/agent-ingest"

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
 */
export async function POST(req: Request) {
  const secret = process.env.FLEETHUB_AGENT_SECRET
  if (!secret) {
    return NextResponse.json({ error: "ingest-not-configured" }, { status: 503 })
  }

  const rawBody = await req.text()
  const sig = req.headers.get("x-pcc2k-signature")
  const ts = req.headers.get("x-pcc2k-timestamp")
  const verified = verifyHmac(rawBody, sig, ts, secret)
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: verified.status })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 })
  }

  try {
    const result = await handleAgentEnvelope(parsed)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof MethodNotSupportedError) {
      return NextResponse.json({ error: e.message, code: -32601 }, { status: 400 })
    }
    const msg = e instanceof Error ? e.message : "internal"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
