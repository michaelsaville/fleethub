import { describe, it, expect } from "vitest"
import { applyRedaction } from "../lib/with-audit"

// Phase 11 WS-A §1 — audit redaction allowlist. The disclose path
// will write the plaintext into the audit detail; without this guard
// the plaintext lands in the hash-chained audit log and can't be
// removed without breaking the chain (HIPAA chain integrity).

describe("applyRedaction", () => {
  it("returns the same object reference-shape when no keys requested", () => {
    const detail = { path: "/api/x", method: "POST", status: 200 }
    const out = applyRedaction(detail, undefined)
    expect(out).toEqual(detail)
  })

  it("returns the same shape when empty redact list", () => {
    const detail = { path: "/api/x", plaintext: "secret" }
    const out = applyRedaction(detail, [])
    // empty list short-circuits to input pass-through
    expect(out.plaintext).toBe("secret")
  })

  it("replaces named keys with [REDACTED]", () => {
    const detail = { path: "/api/x", plaintext: "xxhunter2xx", label: "Slack #ops" }
    const out = applyRedaction(detail, ["plaintext"])
    expect(out.plaintext).toBe("[REDACTED]")
    expect(out.label).toBe("Slack #ops")
    expect(out.path).toBe("/api/x")
  })

  it("redacts every key in the list", () => {
    const detail = { plaintext: "a", newPlaintext: "b", label: "keep" }
    const out = applyRedaction(detail, ["plaintext", "newPlaintext"])
    expect(out.plaintext).toBe("[REDACTED]")
    expect(out.newPlaintext).toBe("[REDACTED]")
    expect(out.label).toBe("keep")
  })

  it("is a no-op for non-existent keys (defensive opt-in)", () => {
    const detail = { path: "/api/x" }
    const out = applyRedaction(detail, ["plaintext", "never-was-here"])
    expect(out).toEqual({ path: "/api/x" })
  })

  it("does not mutate the input object", () => {
    const detail = { plaintext: "secret" }
    const out = applyRedaction(detail, ["plaintext"])
    expect(detail.plaintext).toBe("secret")
    expect(out.plaintext).toBe("[REDACTED]")
  })

  it("redacts even falsy / empty-string values (so a length-leak is impossible)", () => {
    const detail = { plaintext: "" }
    const out = applyRedaction(detail, ["plaintext"])
    expect(out.plaintext).toBe("[REDACTED]")
  })
})
