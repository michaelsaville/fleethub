import "server-only"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { writeAudit } from "./audit"
import { getSessionContext } from "./authz"

// Phase 9 WS-B §4.1 — auto-audit HOC for admin/mutation routes.
//
// The audit gap (PHASE-9-DESIGN §4.1): 18 admin POST/PATCH/DELETE
// routes silently bypass the HIPAA chain. Adding `writeAudit(...)`
// inline at the head of every handler is the noisy version; this
// HOC centralizes the call so every wrapped route writes:
//
//   { actorEmail: <session.email>, action, outcome, detail }
//
// where outcome derives from response status (2xx → "ok",
// 4xx/5xx → "error"). Handlers can pass extra detail by calling
// `setAuditDetail()` from the request context (covered by a separate
// API surface when needed); v1 captures path + status + (optional)
// clientName/deviceId from URL params.

type Handler<Ctx extends { params: Promise<Record<string, string>> }> = (
  req: NextRequest,
  ctx: Ctx,
) => Promise<NextResponse | Response>

interface WithAuditOptions<Ctx extends { params: Promise<Record<string, string>> }> {
  /// Audit action label, e.g. "alertRoute.update" or "runbook.delete".
  action: string
  /// Optional: extract clientName from URL params for the audit row.
  /// e.g. (params) => params.name on /admin/tenants/[name]
  clientNameFromParams?: (params: Awaited<Ctx["params"]>) => string | undefined
  /// Optional: extract deviceId from URL params.
  deviceIdFromParams?: (params: Awaited<Ctx["params"]>) => string | undefined
}

export function withAudit<Ctx extends { params: Promise<Record<string, string>> }>(
  opts: WithAuditOptions<Ctx>,
  handler: Handler<Ctx>,
): Handler<Ctx> {
  return async function (req, ctx) {
    const session = await getSessionContext().catch(() => null)
    const actorEmail = session?.email ?? null

    let resolvedParams: Awaited<Ctx["params"]> | undefined
    try {
      resolvedParams = (await ctx.params) as Awaited<Ctx["params"]>
    } catch {
      // params extraction failure is non-fatal for audit purposes;
      // the handler will surface the real error
    }

    const clientName = opts.clientNameFromParams && resolvedParams
      ? opts.clientNameFromParams(resolvedParams) ?? null
      : null
    const deviceId = opts.deviceIdFromParams && resolvedParams
      ? opts.deviceIdFromParams(resolvedParams) ?? null
      : null

    const url = new URL(req.url)

    let res: NextResponse | Response
    let handlerErr: unknown = null
    try {
      res = await handler(req, ctx)
    } catch (err) {
      handlerErr = err
      res = NextResponse.json(
        { error: err instanceof Error ? err.message : "internal error" },
        { status: 500 },
      )
    }

    const outcome: "ok" | "error" = res.ok ? "ok" : "error"
    const detail: Record<string, unknown> = {
      path: url.pathname,
      method: req.method,
      status: res.status,
    }
    if (handlerErr) {
      detail.error = handlerErr instanceof Error ? handlerErr.message : String(handlerErr)
    }
    // Best-effort: if the handler returned an error body with a `error` field,
    // surface it for the audit row.
    if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
      try {
        const cloned = res.clone()
        const body = (await cloned.json()) as { error?: string }
        if (body?.error) detail.errorReason = body.error
      } catch {
        // ignore
      }
    }

    // Fire-and-forget — never let audit write failure mask the real response.
    await writeAudit({
      actorEmail,
      clientName,
      deviceId,
      action: opts.action,
      outcome,
      detail,
    }).catch((err) => {
      console.error("[withAudit] writeAudit failed", { action: opts.action, err })
    })

    return res
  }
}
