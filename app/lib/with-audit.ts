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
// `addAuditDetail(req, {...})` from inside the wrapped handler.
//
// Phase 11 WS-A §1 extension: a `redactKeys` allowlist replaces
// named keys with "[REDACTED]" in the persisted detailJson BEFORE
// the row is hashed into the audit chain. This is the load-bearing
// safety for credential disclose / update routes — without it,
// plaintext lands in the chain and can't be removed without
// breaking forward-chain verification.

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
  /// Phase 11 WS-A §1 — keys in `detail` (including those added via
  /// addAuditDetail) that MUST NOT land in the audit chain in
  /// plaintext. Each matching value is replaced with "[REDACTED]"
  /// before the row is hashed. Used by credential.disclose +
  /// credential.update + credential.seal routes; the corresponding
  /// disclosure-log table holds the real history.
  ///
  /// IMPORTANT: a redactKey that names a non-existent field is a
  /// no-op (not an error) so callers can opt-in defensively.
  redactKeys?: string[]
}

// Request-scoped detail enrichment. Handlers call
// addAuditDetail(req, { foo: 'bar' }) and the HOC merges into the
// audit row at write time. WeakMap so the per-request data is GC'd
// with the request object.
const requestDetailMap = new WeakMap<NextRequest, Record<string, unknown>>()

/** Add fields to the audit-row detail from within a wrapped handler.
 *  Merges shallow; later calls overwrite earlier values for the same
 *  key. No-op if called from an unwrapped handler. */
export function addAuditDetail(
  req: NextRequest,
  patch: Record<string, unknown>,
): void {
  const existing = requestDetailMap.get(req) ?? {}
  requestDetailMap.set(req, { ...existing, ...patch })
}

/** Apply the redact-key allowlist to a detail object. Mutates a
 *  shallow copy — the input is not modified. Exposed for testability;
 *  the withAudit HOC calls this internally. */
export function applyRedaction(
  detail: Record<string, unknown>,
  redactKeys: string[] | undefined,
): Record<string, unknown> {
  if (!redactKeys || redactKeys.length === 0) return detail
  const out: Record<string, unknown> = { ...detail }
  for (const k of redactKeys) {
    if (k in out) out[k] = "[REDACTED]"
  }
  return out
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
    const baseDetail: Record<string, unknown> = {
      path: url.pathname,
      method: req.method,
      status: res.status,
    }
    if (handlerErr) {
      baseDetail.error = handlerErr instanceof Error ? handlerErr.message : String(handlerErr)
    }
    // Best-effort: if the handler returned an error body with a `error` field,
    // surface it for the audit row.
    if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
      try {
        const cloned = res.clone()
        const body = (await cloned.json()) as { error?: string }
        if (body?.error) baseDetail.errorReason = body.error
      } catch {
        // ignore
      }
    }

    // Merge handler-supplied detail (via addAuditDetail) on top of the
    // base fields, then apply the redact-key allowlist before hashing
    // into the audit chain.
    const handlerSupplied = requestDetailMap.get(req) ?? {}
    requestDetailMap.delete(req)
    const merged: Record<string, unknown> = { ...baseDetail, ...handlerSupplied }
    const detail = applyRedaction(merged, opts.redactKeys)

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
