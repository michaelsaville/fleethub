import { z } from "zod"

// Phase 10 WS-B §4.3 — zod schema + safeParse for the JSON predicate
// stored on Fl_Monitor.predicateJson. Write-side validation in
// monitor-validate.ts produces the same shape; this is the read-side
// guard so the cron evaluator can surface "malformed predicate"
// audit rows instead of silently dropping monitors.

const Operator = z.enum(["lt", "gt", "eq", "neq"])
const OsFilter = z.enum(["windows", "linux", "darwin"])

export const MonitorPredicate = z.object({
  operator: Operator,
  value: z.number().finite(),
  osFilter: OsFilter.optional(),
  deviceTag: z.string().trim().max(64).optional(),
  forMin: z.number().int().positive().max(24 * 60).optional(),
})

export type MonitorPredicate = z.infer<typeof MonitorPredicate>

export type SafeParsePredicateResult =
  | { ok: true; predicate: MonitorPredicate }
  | { ok: false; reason: string }

export function safeParseMonitorPredicateJson(json: string): SafeParsePredicateResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = MonitorPredicate.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `predicate shape mismatch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    }
  }
  return { ok: true, predicate: parsed.data }
}
