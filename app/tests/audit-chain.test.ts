import { describe, it, expect } from "vitest"
import { hashAuditRow } from "../lib/audit-chain"

// Phase 10 WS-B §4.5 — coverage for the canonical hash function.
// Direct insert/tamper/verify via prisma would need a DB fixture;
// here we exercise the hash function's invariants in pure-JS terms.
// Tampering at the row level surfaces as a hashRow mismatch in
// the verifier; this confirms the hash inputs are stable + every
// field participates in the digest.

const baseRow = {
  prevHash: null,
  actorEmail: "alice@example.com",
  clientName: "Acme Corp",
  deviceId: "cmd-001",
  action: "alertRoute.create",
  outcome: "ok",
  detailJson: '{"name":"disk-full","severity":"critical"}',
  createdAt: new Date("2026-05-18T12:00:00.000Z"),
}

describe("hashAuditRow — deterministic over identical input", () => {
  it("returns the same hex for the same row twice", () => {
    expect(hashAuditRow(baseRow)).toBe(hashAuditRow(baseRow))
  })
  it("produces 64-char hex (SHA-256)", () => {
    expect(hashAuditRow(baseRow)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("hashAuditRow — every field participates", () => {
  // For each canonical field, mutate it and assert the digest changes.
  // If any of these fail, a future column add silently broke the chain.
  it("prevHash mutation flips the digest", () => {
    const a = hashAuditRow(baseRow)
    const b = hashAuditRow({ ...baseRow, prevHash: "x".repeat(64) })
    expect(a).not.toBe(b)
  })
  it("actorEmail mutation flips the digest", () => {
    const a = hashAuditRow(baseRow)
    const b = hashAuditRow({ ...baseRow, actorEmail: "mallory@example.com" })
    expect(a).not.toBe(b)
  })
  it("clientName mutation flips the digest", () => {
    const a = hashAuditRow(baseRow)
    const b = hashAuditRow({ ...baseRow, clientName: "Beta Corp" })
    expect(a).not.toBe(b)
  })
  it("deviceId mutation flips the digest", () => {
    const a = hashAuditRow(baseRow)
    const b = hashAuditRow({ ...baseRow, deviceId: "cmd-002" })
    expect(a).not.toBe(b)
  })
  it("action mutation flips the digest", () => {
    const a = hashAuditRow(baseRow)
    const b = hashAuditRow({ ...baseRow, action: "alertRoute.delete" })
    expect(a).not.toBe(b)
  })
  it("outcome mutation flips the digest", () => {
    const a = hashAuditRow(baseRow)
    const b = hashAuditRow({ ...baseRow, outcome: "error" })
    expect(a).not.toBe(b)
  })
  it("detailJson mutation flips the digest", () => {
    const a = hashAuditRow(baseRow)
    const b = hashAuditRow({ ...baseRow, detailJson: '{"name":"tampered"}' })
    expect(a).not.toBe(b)
  })
  it("createdAt mutation flips the digest (1ms apart)", () => {
    const a = hashAuditRow(baseRow)
    const b = hashAuditRow({ ...baseRow, createdAt: new Date(baseRow.createdAt.getTime() + 1) })
    expect(a).not.toBe(b)
  })
})

describe("hashAuditRow — null vs empty-string distinct", () => {
  // The canonical join uses `?? ""` so nulls and empty strings hash
  // the same. This is deliberate (most fields are nullable in the
  // schema) but worth a test so we notice if someone changes the
  // canonical separator.
  it("null actorEmail == empty actorEmail (current behavior)", () => {
    const a = hashAuditRow({ ...baseRow, actorEmail: null })
    const b = hashAuditRow({ ...baseRow, actorEmail: "" })
    expect(a).toBe(b)
  })
})

describe("hashAuditRow — chained rows", () => {
  it("a row's prevHash links to the previous row's rowHash", () => {
    const row1Hash = hashAuditRow(baseRow)
    const row2 = {
      prevHash: row1Hash,
      actorEmail: "bob@example.com",
      clientName: "Acme Corp",
      deviceId: "cmd-001",
      action: "alertRoute.update",
      outcome: "ok",
      detailJson: null,
      createdAt: new Date("2026-05-18T12:01:00.000Z"),
    }
    const row2Hash = hashAuditRow(row2)
    // A verifier walks the chain by hashing row2 with row1.rowHash
    // as its prevHash. If we tamper row1.action, recomputing row1Hash
    // gives a different value → row2's stored prevHash no longer
    // matches the recomputed row1Hash → chain breaks at row 1.
    const tamperedRow1Hash = hashAuditRow({ ...baseRow, action: "TAMPERED" })
    expect(tamperedRow1Hash).not.toBe(row1Hash)
    expect(row2.prevHash).not.toBe(tamperedRow1Hash)
    expect(row2Hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
