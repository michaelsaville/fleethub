import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAlert } from "@/lib/alert-dispatch"
import { writeAudit } from "@/lib/audit"
import { MAPPERS } from "@/lib/inbound-mappers"
import { IgnoredEvent } from "@/lib/inbound-mappers/types"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 4 — inbound webhook receiver. The URL
// path is /api/inbound/<token>; the token is the bearer credential.
// Per-source mappers translate the payload to writeAlert() input.
//
// Response contract:
//   200 with { ok: true, ignored?: true } on success
//   200 with { ok: true, fires: N } when a batch mapper returned
//       multiple alerts
//   400 on mapper rejection (malformed payload). The route still
//       writes a Fl_InboundWebhook.lastError so an operator can
//       see why the tool is failing without tailing logs.
//   404 on unknown / inactive token
//   429 reserved for rate-limit cases (not yet implemented)
//   500 on unexpected mapper / writeAlert failure
//
// HMAC verification (Datadog / Sentry) lives inside the per-source
// mapper, not at this layer — the secret is in the row's configJson
// and the body bytes are what each tool signs.

interface InboundWebhookRow {
  id: string
  name: string
  tenantName: string
  source: string
  configJson: string | null
  isActive: boolean
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "invalid token" }, { status: 404 })
  }

  const rows = await prisma.$queryRaw<InboundWebhookRow[]>`
    SELECT id, name, "tenantName", source, "configJson", "isActive"
    FROM fleethub.fl_inbound_webhooks
    WHERE token = ${token}
    LIMIT 1
  `
  const wh = rows[0]
  if (!wh) {
    // Don't differentiate between "no such token" and "inactive" in
    // the response — that's a polite info-leak guard. Operators see
    // the actual reason on the webhook detail page.
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (!wh.isActive) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const mapper = MAPPERS[wh.source]
  if (!mapper) {
    await recordError(wh.id, `unsupported source "${wh.source}"`)
    return NextResponse.json(
      { error: `unsupported source "${wh.source}"` },
      { status: 500 },
    )
  }

  const rawBody = await req.text()
  let parsedBody: unknown = null
  try {
    parsedBody = rawBody.length > 0 ? JSON.parse(rawBody) : null
  } catch {
    // Some sources post form-encoded; mappers that want raw bytes
    // get rawBody. Leave parsedBody null and let the mapper decide
    // whether to reject.
    parsedBody = null
  }

  let config: Record<string, unknown> | null = null
  if (wh.configJson) {
    try {
      config = JSON.parse(wh.configJson) as Record<string, unknown>
    } catch {
      config = null
    }
  }

  // Lower-case all headers once so mappers don't re-do it per access.
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })

  let result
  try {
    result = await mapper({
      tenantName: wh.tenantName,
      config,
      rawBody,
      headers,
      parsedBody,
    })
  } catch (err) {
    if (err instanceof IgnoredEvent) {
      // Sender wanted a 2xx; we honor that + record the fire so the
      // detail page shows non-firing traffic too.
      await recordFire(wh.id)
      return NextResponse.json({ ok: true, ignored: true, reason: err.message })
    }
    const msg = err instanceof Error ? err.message : String(err)
    await recordError(wh.id, msg)
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const alerts = Array.isArray(result) ? result : [result]
  const created: string[] = []
  for (const a of alerts) {
    try {
      const alert = await writeAlert({
        clientName: a.clientName,
        deviceId: a.deviceId ?? null,
        kind: a.kind,
        severity: a.severity,
        title: a.title,
        detailJson: a.detailJson ?? null,
      })
      created.push(alert.id)
    } catch (err) {
      // writeAlert itself audits dispatch failures, but the alert
      // creation failing wholesale is rare (DB issues). Surface it.
      console.error("[inbound] writeAlert failed", err)
    }
  }

  await recordFire(wh.id)
  await writeAudit({
    clientName: wh.tenantName,
    action: "inbound.webhook.fired",
    outcome: "ok",
    detail: {
      webhookId: wh.id,
      source: wh.source,
      alertCount: created.length,
      alertIds: created,
    },
  }).catch(() => undefined)

  return NextResponse.json({ ok: true, fires: created.length, alertIds: created })
}

async function recordFire(webhookId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE fleethub.fl_inbound_webhooks
    SET "lastFiredAt" = NOW(),
        "fireCount"   = "fireCount" + 1,
        "updatedAt"   = NOW()
    WHERE id = ${webhookId}
  `.catch(() => undefined)
}

async function recordError(webhookId: string, message: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE fleethub.fl_inbound_webhooks
    SET "lastErrorAt" = NOW(),
        "lastError"   = ${message.slice(0, 500)},
        "errorCount"  = "errorCount" + 1,
        "updatedAt"   = NOW()
    WHERE id = ${webhookId}
  `.catch(() => undefined)
}
