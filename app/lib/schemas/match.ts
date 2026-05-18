import { z } from "zod"
import { SeverityListLoose, type Severity } from "./severity"

// Phase 8 Workstream C §5.3 — match-predicate schema. The same
// shape Fl_AlertRoute.matchJson / Fl_Runbook.matchJson / a future
// Fl_Monitor predicate share: { severity?, kindLike? }. Each
// caller normalizes/empties as it sees fit on the producer side;
// downstream readers (alert-dispatch.matchesAlert, runbook-evaluator)
// already accept the union of both shapes.

export const MatchPredicate = z.object({
  severity: SeverityListLoose.optional(),
  kindLike: z
    .string()
    .trim()
    .max(200, "kindLike must be 200 characters or fewer")
    .optional(),
})

export type MatchPredicate = {
  severity?: Severity[]
  kindLike?: string
}

/// Parse a Record<string, unknown> match object into the normalized
/// shape stored on the model. Empty severity arrays + empty kindLike
/// strings are dropped so the resulting JSON is minimal.
export function normalizeMatch(raw: unknown): MatchPredicate {
  const parsed = MatchPredicate.parse(raw ?? {})
  const out: MatchPredicate = {}
  if (parsed.severity && parsed.severity.length > 0) out.severity = parsed.severity
  if (parsed.kindLike) out.kindLike = parsed.kindLike
  return out
}

/// Phase 9 WS-B §4.2 — read-side safe parse for JSON-stored
/// matchJson. Returns a discriminated result so callers can surface
/// the reason as an audit row rather than silently `continue`-ing.
///
/// Write-side validation enforces the shape; this guards against
/// manual SQL fixes, enum additions, or pre-validator legacy rows.
export type SafeParseMatchResult =
  | { ok: true; predicate: MatchPredicate }
  | { ok: false; reason: string }

export function safeParseMatchJson(json: string): SafeParseMatchResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = MatchPredicate.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `match shape mismatch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    }
  }
  return { ok: true, predicate: parsed.data }
}
