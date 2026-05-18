import { describe, it, expect, beforeAll } from "vitest"
import { mintMfaCookieValue, verifyMfaCookieValue } from "../lib/mfa-cookie"

// Phase 11 WS-E.6 — closes the Phase-10 gap on mfa-cookie.ts.
// Tests the mint → verify roundtrip plus the four failure modes:
// malformed, expired, signature mismatch, missing.

beforeAll(() => {
  if (!process.env.NEXTAUTH_SECRET) {
    process.env.NEXTAUTH_SECRET = "test-secret-for-mfa-cookie-tests-only"
  }
})

describe("mfa-cookie mint+verify", () => {
  it("roundtrip succeeds for a freshly-minted cookie", async () => {
    const minted = await mintMfaCookieValue("user-abc")
    const verified = await verifyMfaCookieValue(minted.value)
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(verified.userId).toBe("user-abc")
  })

  it("missing cookie returns ok=false with reason 'missing'", async () => {
    const r1 = await verifyMfaCookieValue(undefined)
    expect(r1).toEqual({ ok: false, reason: "missing" })
    const r2 = await verifyMfaCookieValue(null)
    expect(r2).toEqual({ ok: false, reason: "missing" })
    const r3 = await verifyMfaCookieValue("")
    expect(r3).toEqual({ ok: false, reason: "missing" })
  })

  it("malformed cookie (wrong segment count) rejected", async () => {
    const r1 = await verifyMfaCookieValue("only.two.parts.nope.zzz")
    expect(r1.ok).toBe(false)
    const r2 = await verifyMfaCookieValue("oneonly")
    expect(r2.ok).toBe(false)
  })

  it("tampered userId fails signature check", async () => {
    const minted = await mintMfaCookieValue("user-real")
    // Surgically swap userId — same exp, same sig
    const parts = minted.value.split(".")
    const tampered = `user-faked.${parts[1]}.${parts[2]}`
    const verified = await verifyMfaCookieValue(tampered)
    expect(verified.ok).toBe(false)
  })

  it("tampered signature rejected", async () => {
    const minted = await mintMfaCookieValue("user-real")
    const parts = minted.value.split(".")
    const tampered = `${parts[0]}.${parts[1]}.${"0".repeat(parts[2].length)}`
    const verified = await verifyMfaCookieValue(tampered)
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.reason).toBe("signature mismatch")
  })

  it("expired cookie rejected with reason 'expired'", async () => {
    // Mint with TTL=0 — already-expired by the time we verify.
    const minted = await mintMfaCookieValue("user-x", -1000)
    // Sleep a moment to ensure clock walks past the negative TTL
    await new Promise((r) => setTimeout(r, 5))
    const verified = await verifyMfaCookieValue(minted.value)
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.reason).toBe("expired")
  })

  it("invalid exp field rejected", async () => {
    const verified = await verifyMfaCookieValue("user-a.notanumber.deadbeef")
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.reason).toBe("invalid exp")
  })

  it("constant-time compare — different-length sigs reject without throw", async () => {
    const verified = await verifyMfaCookieValue("user-a.99999999999999.tooshort")
    expect(verified.ok).toBe(false)
  })

  it("two consecutive mints produce different cookies (different exp ms)", async () => {
    const a = await mintMfaCookieValue("user-y")
    await new Promise((r) => setTimeout(r, 2))
    const b = await mintMfaCookieValue("user-y")
    expect(a.value).not.toBe(b.value)
  })
})
