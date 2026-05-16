import "server-only"

// Phase 7 Workstream B step 5 — dry-run predicate evaluator.
//
// Predicates are JSON objects that decide whether a successful
// dry-run should be followed by a real run. v1 supports:
//
//   { "exitCode": 0 }                  exact-match the script's exit code
//   { "stdoutContains": "would free" } substring match on stdout
//   { "stdoutRegex": "freed \\d+ GB" } regex match on stdout (case-insensitive)
//
// Multiple keys on one predicate AND together — all must pass for
// the predicate to pass. When the predicate JSON is null the
// default is "dry-run finished with exitCode 0", which is the
// natural "the dry-run worked, so the real run should also work"
// semantics.
//
// Composition (and / or / not) is deliberately out of scope for
// v1 — operators who need it will say so. KISS.

interface PredicateShape {
  exitCode?: number
  stdoutContains?: string
  stdoutRegex?: string
}

export interface PredicateInput {
  state: string
  exitCode: number | null
  output: string | null
}

export interface PredicateResult {
  pass: boolean
  reason: string
}

export function evaluatePredicate(
  predicateJson: string | null,
  run: PredicateInput,
): PredicateResult {
  // Dry-run itself errored — predicate is irrelevant; fail.
  if (run.state !== "ok") {
    return { pass: false, reason: `dry-run state=${run.state}, predicate skipped` }
  }

  if (!predicateJson) {
    const ok = (run.exitCode ?? 0) === 0
    return ok
      ? { pass: true, reason: "default predicate (exitCode=0) passed" }
      : { pass: false, reason: `default predicate (exitCode=0) failed; got ${run.exitCode}` }
  }

  let predicate: PredicateShape
  try {
    const parsed = JSON.parse(predicateJson) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { pass: false, reason: "predicate must be a JSON object" }
    }
    predicate = parsed as PredicateShape
  } catch {
    return { pass: false, reason: "predicate JSON failed to parse — runbook should re-validate" }
  }

  // AND across keys. Empty predicate ≡ "always pass" (caller asked
  // for that explicitly with {}; we respect it).
  if (typeof predicate.exitCode === "number") {
    if ((run.exitCode ?? null) !== predicate.exitCode) {
      return { pass: false, reason: `exitCode ${run.exitCode} ≠ expected ${predicate.exitCode}` }
    }
  }
  if (typeof predicate.stdoutContains === "string" && predicate.stdoutContains.length > 0) {
    const needle = predicate.stdoutContains
    const hay = run.output ?? ""
    if (!hay.includes(needle)) {
      return { pass: false, reason: `stdout did not contain "${truncate(needle, 60)}"` }
    }
  }
  if (typeof predicate.stdoutRegex === "string" && predicate.stdoutRegex.length > 0) {
    let re: RegExp
    try {
      re = new RegExp(predicate.stdoutRegex, "i")
    } catch (err) {
      return { pass: false, reason: `stdoutRegex invalid: ${(err as Error).message}` }
    }
    if (!re.test(run.output ?? "")) {
      return { pass: false, reason: `stdout did not match /${truncate(predicate.stdoutRegex, 60)}/i` }
    }
  }

  return { pass: true, reason: "predicate passed" }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}
