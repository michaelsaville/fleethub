import "server-only"

// Phase 7 Workstream B step 3 — Fl_Runbook payload validator.
// Shared by POST + PATCH so the create and edit paths apply
// identical rules.

type Severity = "critical" | "warn" | "info"
const SEVERITY_VALUES: readonly Severity[] = ["critical", "warn", "info"]

export interface NormalizedMatch {
  severity?: Severity[]
  kindLike?: string
}

export interface ValidRunbookPayload {
  ok: true
  name: string
  description: string | null
  match: NormalizedMatch
  scriptId: string
  graceMin: number
  cooldownMin: number
  dryRunFirst: boolean
  dryRunPredicateJson: string | null
  maxFiresPerHour: number
  maxConsecutiveFailures: number
  isActive: boolean
}

export type ValidateResult =
  | ValidRunbookPayload
  | { ok: false; reason: string }

export function validateRunbookPayload(body: Record<string, unknown>): ValidateResult {
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return { ok: false, reason: "name is required" }
  if (name.length > 80) return { ok: false, reason: "name must be 80 characters or fewer" }

  const description = typeof body.description === "string" && body.description.trim()
    ? body.description.trim().slice(0, 500)
    : null

  const scriptId = typeof body.scriptId === "string" ? body.scriptId.trim() : ""
  if (!scriptId) return { ok: false, reason: "scriptId is required" }

  const matchIn = (body.match ?? {}) as Record<string, unknown>
  const severityIn = matchIn.severity
  const severity: Severity[] = []
  if (Array.isArray(severityIn)) {
    for (const s of severityIn) {
      if (typeof s === "string" && (SEVERITY_VALUES as readonly string[]).includes(s)) {
        severity.push(s as Severity)
      }
    }
  } else if (typeof severityIn === "string" && (SEVERITY_VALUES as readonly string[]).includes(severityIn)) {
    severity.push(severityIn as Severity)
  }
  const kindLikeRaw = typeof matchIn.kindLike === "string" ? matchIn.kindLike.trim() : ""
  if (kindLikeRaw.length > 200) {
    return { ok: false, reason: "match.kindLike must be 200 characters or fewer" }
  }
  const match: NormalizedMatch = {}
  if (severity.length > 0) match.severity = severity
  if (kindLikeRaw) match.kindLike = kindLikeRaw

  if (severity.length === 0 && !kindLikeRaw) {
    return { ok: false, reason: "match must include at least a severity or a kindLike — an unbounded runbook would fire on every alert" }
  }

  const graceMin = clampInt(body.graceMin, 0, 1440, 2)
  const cooldownMin = clampInt(body.cooldownMin, 0, 1440, 30)
  const maxFiresPerHour = clampInt(body.maxFiresPerHour, 1, 1000, 10)
  const maxConsecutiveFailures = clampInt(body.maxConsecutiveFailures, 1, 100, 3)
  const dryRunFirst = body.dryRunFirst !== false

  // dryRunPredicateJson is opaque to v1 step 3 — we just validate
  // it parses. Step 5 introduces the predicate schema + evaluator.
  let dryRunPredicateJson: string | null = null
  if (typeof body.dryRunPredicate === "string" && body.dryRunPredicate.trim()) {
    const raw = body.dryRunPredicate.trim()
    try {
      JSON.parse(raw)
    } catch {
      return { ok: false, reason: "dryRunPredicate must be valid JSON (leave blank to omit)" }
    }
    if (raw.length > 2000) return { ok: false, reason: "dryRunPredicate must be 2000 characters or fewer" }
    dryRunPredicateJson = raw
  } else if (body.dryRunPredicate && typeof body.dryRunPredicate === "object") {
    // Allow client to send a parsed object too.
    dryRunPredicateJson = JSON.stringify(body.dryRunPredicate)
  }

  const isActive = body.isActive !== false

  return {
    ok: true,
    name,
    description,
    match,
    scriptId,
    graceMin,
    cooldownMin,
    dryRunFirst,
    dryRunPredicateJson,
    maxFiresPerHour,
    maxConsecutiveFailures,
    isActive,
  }
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, Math.floor(n)))
}
