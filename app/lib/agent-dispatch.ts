import "server-only"
import { createHmac } from "node:crypto"

// Server→agent push via the WSS gateway's POST /agent/dispatch endpoint.
// Same HMAC scheme as inbound /api/agent-ingest (`${ts}.${rawBody}` signed
// with FLEETHUB_AGENT_SECRET). The gateway looks up the agent's WS by
// agentId, signs the frame with the per-session key, sends it down the
// wire, and returns 200/404.
//
// Phase 2 caller: lib/script-commands.ts:runScript() — replaces the prior
// simulateScriptResult mock.

export interface DispatchOptions {
  agentId: string
  method: string
  params: Record<string, unknown>
  // When set, the gateway forwards a JSON-RPC `id` so the agent replies.
  // For long-running commands per AGENT-PROTOCOL §10.1 the reply is
  // immediate `{state: "queued"}`; the actual outcome arrives later via
  // notifications.
  id?: string
}

export type DispatchResult =
  | { ok: true; sentAt: string }
  | { ok: false; status: number; error: string }

export async function dispatchToAgent(opts: DispatchOptions): Promise<DispatchResult> {
  const baseUrl = process.env.PCC2K_GATEWAY_URL
  const secret = process.env.FLEETHUB_AGENT_SECRET
  if (!baseUrl) return { ok: false, status: 500, error: "PCC2K_GATEWAY_URL not set" }
  if (!secret) return { ok: false, status: 500, error: "FLEETHUB_AGENT_SECRET not set" }

  const body = JSON.stringify({
    agentId: opts.agentId,
    method: opts.method,
    params: opts.params,
    ...(opts.id ? { id: opts.id } : {}),
  })
  const ts = String(Date.now())
  const sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")
  const url = `${baseUrl.replace(/\/+$/, "")}/agent/dispatch`

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pcc2k-signature": sig,
        "x-pcc2k-timestamp": ts,
      },
      body,
    })
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: `gateway-unreachable: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: typeof json.error === "string" ? json.error : `http-${res.status}`,
    }
  }
  return { ok: true, sentAt: typeof json.sentAt === "string" ? json.sentAt : new Date().toISOString() }
}
