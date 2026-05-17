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
