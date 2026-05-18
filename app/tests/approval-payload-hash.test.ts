import { describe, it, expect } from "vitest"
import { hashPayload } from "../lib/approval-gate"

// Phase 11 WS-E.6 — pure-logic coverage of the canonical-JSON +
// SHA-256 payload hash used by 4-eyes anti-swap. The state-machine
// transitions (approve/deny/consume race) need a live DB so they
// land in an integration test or smoke; the canonicalization is
// pure logic and worth nailing down.

describe("hashPayload canonicalization", () => {
  it("key order does not affect hash", () => {
    const a = hashPayload({ b: 2, a: 1 })
    const b = hashPayload({ a: 1, b: 2 })
    expect(a.hex).toBe(b.hex)
    expect(a.canonical).toBe(b.canonical)
  })

  it("nested object key order does not affect hash", () => {
    const a = hashPayload({ outer: { z: 9, m: 5, a: 1 } })
    const b = hashPayload({ outer: { a: 1, m: 5, z: 9 } })
    expect(a.hex).toBe(b.hex)
  })

  it("array order DOES affect hash (lists are ordered)", () => {
    const a = hashPayload({ ids: ["a", "b"] })
    const b = hashPayload({ ids: ["b", "a"] })
    expect(a.hex).not.toBe(b.hex)
  })

  it("different scalar values produce different hashes", () => {
    expect(hashPayload({ x: 1 }).hex).not.toBe(hashPayload({ x: 2 }).hex)
    expect(hashPayload({ x: "a" }).hex).not.toBe(hashPayload({ x: "b" }).hex)
    expect(hashPayload({ x: true }).hex).not.toBe(hashPayload({ x: false }).hex)
  })

  it("missing key vs explicit null differ", () => {
    expect(hashPayload({}).hex).not.toBe(hashPayload({ x: null }).hex)
  })

  it("nested array+object combination is stable", () => {
    const p = {
      action: "bulk.dispatch",
      deviceIds: ["d1", "d2", "d3"],
      tenantName: "Acme",
      dryRun: false,
    }
    const a = hashPayload(p)
    const b = hashPayload({
      dryRun: false,
      tenantName: "Acme",
      deviceIds: ["d1", "d2", "d3"],
      action: "bulk.dispatch",
    })
    expect(a.hex).toBe(b.hex)
  })

  it("hex output is 64 chars (SHA-256)", () => {
    expect(hashPayload({ x: 1 }).hex).toMatch(/^[0-9a-f]{64}$/)
  })

  it("primitives are accepted at root level (string)", () => {
    expect(hashPayload("hello").hex).toBe(hashPayload("hello").hex)
    expect(hashPayload("hello").hex).not.toBe(hashPayload("world").hex)
  })

  it("primitives are accepted at root level (number)", () => {
    expect(hashPayload(42).hex).toBe(hashPayload(42).hex)
    expect(hashPayload(42).hex).not.toBe(hashPayload(43).hex)
  })

  it("empty object has stable hash", () => {
    expect(hashPayload({}).hex).toBe(hashPayload({}).hex)
  })

  it("deeply nested arrays preserve order", () => {
    const a = hashPayload({ matrix: [[1, 2], [3, 4]] })
    const b = hashPayload({ matrix: [[2, 1], [3, 4]] })
    expect(a.hex).not.toBe(b.hex)
  })
})
