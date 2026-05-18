import { describe, it, expect } from "vitest"
import { evaluatePredicate } from "../lib/runbook-predicate"

// Phase 10 WS-B §4.5 — coverage for the dry-run → real-run gate.
// Silent-failure surface: a wrong-shape predicate could let a
// destructive runbook fire after a degenerate dry-run.

const ranOk = (output: string | null, exitCode = 0) => ({
  state: "ok",
  exitCode,
  output,
})

describe("evaluatePredicate — pre-conditions", () => {
  it("dry-run not ok → predicate skipped", () => {
    const r = evaluatePredicate(null, { state: "failed", exitCode: 1, output: "boom" })
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/dry-run state=failed/)
  })
  it("null predicate + exitCode=0 → pass (default)", () => {
    expect(evaluatePredicate(null, ranOk("ok", 0)).pass).toBe(true)
  })
  it("null predicate + exitCode=1 → fail (default)", () => {
    expect(evaluatePredicate(null, ranOk("ok", 1)).pass).toBe(false)
  })
  it("null predicate + exitCode null → treated as 0 → pass", () => {
    expect(evaluatePredicate(null, { state: "ok", exitCode: null, output: null }).pass).toBe(true)
  })
})

describe("evaluatePredicate — malformed JSON", () => {
  it("invalid JSON → fail with re-validate message", () => {
    const r = evaluatePredicate("{not json", ranOk(""))
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/predicate JSON failed/)
  })
  it("non-object root → fail", () => {
    expect(evaluatePredicate("[]", ranOk("")).pass).toBe(false)
    expect(evaluatePredicate('"string"', ranOk("")).pass).toBe(false)
    expect(evaluatePredicate("42", ranOk("")).pass).toBe(false)
  })
  it("empty object {} → pass (operator opted in)", () => {
    expect(evaluatePredicate("{}", ranOk("anything", 1)).pass).toBe(true)
  })
})

describe("evaluatePredicate — exitCode", () => {
  it("matches exact zero", () => {
    expect(evaluatePredicate('{"exitCode":0}', ranOk("", 0)).pass).toBe(true)
  })
  it("matches arbitrary expected value", () => {
    expect(evaluatePredicate('{"exitCode":2}', ranOk("", 2)).pass).toBe(true)
  })
  it("fails on mismatch", () => {
    const r = evaluatePredicate('{"exitCode":0}', ranOk("", 1))
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/exitCode 1 ≠ expected 0/)
  })
  it("null exitCode does not match expected 0", () => {
    // The implementation maps null exitCode → null for strict
    // comparison; only explicit-0 satisfies expected-0.
    expect(evaluatePredicate('{"exitCode":0}', { state: "ok", exitCode: null, output: null }).pass).toBe(false)
  })
})

describe("evaluatePredicate — stdoutContains", () => {
  it("substring present → pass", () => {
    expect(evaluatePredicate('{"stdoutContains":"would free"}', ranOk("would free 5GB")).pass).toBe(true)
  })
  it("substring absent → fail", () => {
    const r = evaluatePredicate('{"stdoutContains":"would free"}', ranOk("nothing to do"))
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/did not contain/)
  })
  it("case-sensitive substring (current contract)", () => {
    expect(evaluatePredicate('{"stdoutContains":"WOULD FREE"}', ranOk("would free 5GB")).pass).toBe(false)
  })
  it("empty stdoutContains is ignored", () => {
    expect(evaluatePredicate('{"stdoutContains":""}', ranOk("anything")).pass).toBe(true)
  })
})

describe("evaluatePredicate — stdoutRegex", () => {
  it("regex match (case-insensitive)", () => {
    expect(evaluatePredicate('{"stdoutRegex":"freed \\\\d+ GB"}', ranOk("Freed 12 GB.")).pass).toBe(true)
  })
  it("regex no match → fail", () => {
    const r = evaluatePredicate('{"stdoutRegex":"freed \\\\d+ GB"}', ranOk("nothing happened"))
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/did not match/)
  })
  it("invalid regex returns explicit failure (does not throw)", () => {
    const r = evaluatePredicate('{"stdoutRegex":"["}', ranOk("anything"))
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/stdoutRegex invalid/)
  })
})

describe("evaluatePredicate — AND across multiple keys", () => {
  it("all keys must pass", () => {
    const pred = '{"exitCode":0,"stdoutContains":"OK","stdoutRegex":"\\\\d+"}'
    expect(evaluatePredicate(pred, ranOk("OK 42", 0)).pass).toBe(true)
  })
  it("any failing key → fail", () => {
    const pred = '{"exitCode":0,"stdoutContains":"OK"}'
    expect(evaluatePredicate(pred, ranOk("OK 42", 1)).pass).toBe(false) // exitCode fails
    expect(evaluatePredicate(pred, ranOk("FAIL", 0)).pass).toBe(false) // contains fails
  })
})
