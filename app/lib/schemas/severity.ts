import { z } from "zod"

// Phase 8 Workstream C §5.3 — severity atom. Bounded enum reused
// across alert routes, runbooks, monitors. The string union
// `"critical" | "warn" | "info"` is the same one Fl_Alert.severity
// stores; keeping it in one place means a new band (e.g. "fatal")
// is a single-file change.

export const SeverityEnum = z.enum(["critical", "warn", "info"])
export type Severity = z.infer<typeof SeverityEnum>

/// Accepts either a single token or an array. Returns the normalized
/// array (empty when input was missing / unrecognized). Used by
/// route + runbook + monitor predicate parsing.
export const SeverityListLoose = z.preprocess((v) => {
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string")
  if (typeof v === "string" && v) return [v]
  return []
}, z.array(SeverityEnum))
