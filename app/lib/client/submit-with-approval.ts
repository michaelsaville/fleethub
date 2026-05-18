// Phase 12 WS-E.3 — client-side approval-aware POST helper.
//
// Seven server routes return 202 with `{status: "approval-required",
// approvalId, reason?}` when a tenant policy or threshold triggers
// 4-eyes. Before this helper, each client call site had to:
//   1. detect 202 distinctly from 200
//   2. parse the approvalId out
//   3. show "awaiting peer approval" UI
//   4. on second attempt, include approvalId in body
//
// Without it, AlertsTable.onBulkAck etc. treat 202 as success
// (silent-success bug per Phase 12 architect §1). This helper
// returns a discriminated union so call sites get a compile-time
// reminder to handle each branch.

export type SubmitResult<T = unknown> =
  | { kind: "ok"; data: T }
  | {
      kind: "approval-required"
      approvalId: string
      reason?: string
    }
  | { kind: "error"; status: number; message: string }

export interface SubmitOptions {
  method?: "POST" | "PATCH" | "PUT" | "DELETE"
  /** Caller's body — approvalId will be merged in when provided. */
  body?: unknown
  /** Approval id from a prior 202; included in body for the
   *  second-pass submit. Server consumes via consumeApproval. */
  approvalId?: string
  /** Step-up token for credential disclose / update flows.
   *  Header: X-FleetHub-StepUp. */
  stepUpToken?: string
  /** Optional fetch override (for testing). */
  fetchImpl?: typeof fetch
}

/** POST/PATCH/PUT/DELETE that understands 202+approvalId. Use this
 *  anywhere the route may be 4-eyes-gated by tenant policy — even
 *  if the current path doesn't gate, the helper is a no-op cost
 *  vs the silent-success bug. */
export async function submitWithApproval<T = unknown>(
  url: string,
  opts: SubmitOptions = {},
): Promise<SubmitResult<T>> {
  const method = opts.method ?? "POST"
  const fetchFn = opts.fetchImpl ?? fetch
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (opts.stepUpToken) {
    headers["X-FleetHub-StepUp"] = opts.stepUpToken
  }
  // Merge approvalId into the body when provided (most routes accept
  // it that way). DELETE routes use ?approvalId= query string — caller
  // is expected to format the URL accordingly for those.
  const mergedBody =
    opts.approvalId && opts.body !== undefined
      ? { ...(opts.body as Record<string, unknown>), approvalId: opts.approvalId }
      : opts.body
  const res = await fetchFn(url, {
    method,
    headers,
    body: mergedBody !== undefined ? JSON.stringify(mergedBody) : undefined,
  })
  // 202 carries the approval-required envelope. ok would be true
  // (res.ok is true for 2xx) — distinguish by status code AND body
  // shape.
  if (res.status === 202) {
    let body: unknown
    try {
      body = await res.json()
    } catch {
      // 202 without JSON body — treat as ok with no data.
      return { kind: "ok", data: undefined as T }
    }
    const shape = body as {
      status?: string
      approvalId?: string
      reason?: string
    }
    if (shape.status === "approval-required" && shape.approvalId) {
      return {
        kind: "approval-required",
        approvalId: shape.approvalId,
        reason: shape.reason,
      }
    }
    // 202 without our envelope — assume the route is async-but-
    // accepted; surface as ok.
    return { kind: "ok", data: body as T }
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) msg = body.error
    } catch {
      // ignore — leave HTTP status as the message
    }
    return { kind: "error", status: res.status, message: msg }
  }
  // 2xx happy path
  try {
    const data = (await res.json()) as T
    return { kind: "ok", data }
  } catch {
    return { kind: "ok", data: undefined as T }
  }
}

/** Convenience: format the user-facing "request created" message. */
export function approvalToastText(result: Extract<SubmitResult, { kind: "approval-required" }>): string {
  return `Awaiting peer approval (${result.approvalId.slice(0, 8)}…)${result.reason ? ` — ${result.reason}` : ""}`
}
