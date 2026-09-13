import { NextRequest, NextResponse } from "next/server"
import { writeAudit } from "@/lib/audit"
import { consumeEnrollToken, enrollWithTenantKey, looksLikeEnrollKey } from "@/lib/agent-enroll"

// Phase 13 WS-D.0 — agent bootstrap consumer.
//
// Agent posts:
//   { token, hostname?, os?, osVersion? }
// Returns on success (HTTP 201):
//   { agentId, agentSecret, fleethubBaseUrl, tenantName }
// On token-not-found: 404.
// On expired / already-consumed: 410-Gone.
//
// agentSecret is plaintext ONCE — agent stores it in OS keystore
// before exiting the bootstrap call. Server keeps only the bcrypt
// hash.
//
// Not behind requireAdmin — the token is the auth. Auditable via
// enroll-token.consumed even when the request is anonymous; the
// audit row records consumed-from IP for forensics.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: string
    hostname?: string
    os?: string
    osVersion?: string
  }
  if (!body.token) {
    return NextResponse.json({ error: "token required" }, { status: 400 })
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null

  // Two credentials share this endpoint: a 64-hex single-use token, or a
  // 40-hex per-tenant enrollment key (the installer-link path — never
  // consumed, revoked by rotating the key).
  const viaKey = looksLikeEnrollKey(body.token)
  const result = viaKey
    ? await enrollWithTenantKey({
        key: body.token,
        hostname: body.hostname ?? null,
        os: body.os ?? null,
        osVersion: body.osVersion ?? null,
      })
    : await consumeEnrollToken({
        token: body.token,
        hostname: body.hostname ?? null,
        os: body.os ?? null,
        osVersion: body.osVersion ?? null,
        ip,
      })

  if (!result.ok) {
    await writeAudit({
      action: viaKey ? "enroll-key.use.fail" : "enroll-token.consume.fail",
      outcome: "error",
      detail: { reason: result.reason, ip, hostname: body.hostname ?? null },
    }).catch(() => {})
    return NextResponse.json(
      { error: `enroll-token: ${result.reason}` },
      { status: result.status },
    )
  }

  await writeAudit({
    clientName: result.tenantName,
    action: viaKey ? "enroll-key.used" : "enroll-token.consumed",
    outcome: "ok",
    detail: {
      agentId: result.agentId,
      ip,
      hostname: body.hostname ?? null,
      os: body.os ?? null,
    },
  }).catch(() => {})

  return NextResponse.json(
    {
      agentId: result.agentId,
      agentSecret: result.agentSecret,
      fleethubBaseUrl: result.fleethubBaseUrl,
      gatewayUrl: result.gatewayUrl,
      tenantName: result.tenantName,
    },
    { status: 201 },
  )
}
