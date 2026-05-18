import { describe, it, expect } from "vitest"
import {
  generateSecret,
  otpauthUrl,
  verifyTotp,
  generateRecoveryCodes,
  consumeRecoveryCode,
} from "../lib/mfa"

// Phase 10 WS-B §4.5 — coverage for the TOTP MFA helpers. otplib's
// internals are already covered by their own suite; this tests
// FleetHub's contract over them (correct period/digits, recovery-
// code consume-once semantics, secret-generation invariants).

describe("generateSecret", () => {
  it("returns a base32 string of reasonable length", () => {
    const s = generateSecret()
    expect(s).toMatch(/^[A-Z2-7]+=*$/)
    expect(s.length).toBeGreaterThanOrEqual(16)
  })
  it("two consecutive calls return different secrets", () => {
    expect(generateSecret()).not.toBe(generateSecret())
  })
})

describe("otpauthUrl", () => {
  it("builds an otpauth:// URI with FleetHub issuer + email label", () => {
    const secret = generateSecret()
    const url = otpauthUrl("alice@example.com", secret)
    expect(url).toMatch(/^otpauth:\/\/totp\//)
    expect(url).toContain("FleetHub")
    expect(url).toContain("alice")
    expect(url).toContain(`secret=${secret}`)
  })
})

describe("verifyTotp", () => {
  // otplib v13 requires secrets of at least 16 bytes (128 bits) = 26
  // base32 chars. Use generateSecret() which produces 20-byte secrets
  // by default. Round-trip generate+verify because we can't predict
  // the time-bucket code value.
  it("rejects an empty token", () => {
    expect(verifyTotp("", generateSecret())).toBe(false)
  })
  it("rejects a token that isn't 6 digits", () => {
    const secret = generateSecret()
    expect(verifyTotp("12345", secret)).toBe(false)
    expect(verifyTotp("1234567", secret)).toBe(false)
  })
  it("rejects a non-numeric token of length 6", () => {
    expect(verifyTotp("abcdef", generateSecret())).toBe(false)
  })
  it("accepts the current-period code for a known secret (round trip)", async () => {
    const { OTP } = await import("otplib")
    const otp = new OTP({ strategy: "totp" })
    const secret = generateSecret()
    const token = otp.generateSync({ secret, digits: 6, period: 30 })
    expect(token).toMatch(/^\d{6}$/)
    expect(verifyTotp(token, secret)).toBe(true)
  })
  it("rejects an obviously wrong code for a known secret", () => {
    // Try a sweep of unlikely codes; with clock skew window ±1, even
    // a "0% expected match rate" has a vanishingly small probability
    // of >1 hit in 4 attempts.
    const secret = generateSecret()
    const wrongs = ["000000", "111111", "222222", "987654"]
    const passes = wrongs.filter((t) => verifyTotp(t, secret)).length
    // With clock skew window ±1, even a "0%" expected match rate has
    // a vanishingly small probability of >1 hit in 4 attempts.
    expect(passes).toBeLessThanOrEqual(1)
  })
})

describe("generateRecoveryCodes", () => {
  it("returns N plaintext + N hashed codes by default 10", async () => {
    const { plaintext, hashed } = await generateRecoveryCodes()
    expect(plaintext).toHaveLength(10)
    expect(hashed).toHaveLength(10)
  })
  it("plaintext codes are 8-char hex (uppercase)", async () => {
    const { plaintext } = await generateRecoveryCodes(3)
    for (const p of plaintext) {
      expect(p).toMatch(/^[0-9A-F]{8}$/)
    }
  })
  it("hashed codes are salt:hex (32-char hash) entries", async () => {
    const { hashed } = await generateRecoveryCodes(2)
    for (const h of hashed) {
      const [salt, hash] = h.split(":")
      expect(salt).toMatch(/^[0-9a-f]+$/)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe("consumeRecoveryCode", () => {
  it("returns null on no match", async () => {
    const { hashed } = await generateRecoveryCodes(3)
    const result = await consumeRecoveryCode("NOMATCH1", hashed)
    expect(result).toBeNull()
  })
  it("removes the code on match (consume-once)", async () => {
    const { plaintext, hashed } = await generateRecoveryCodes(3)
    const result = await consumeRecoveryCode(plaintext[1], hashed)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
  })
  it("second consume of same code on remaining hashes fails", async () => {
    const { plaintext, hashed } = await generateRecoveryCodes(3)
    const remaining = await consumeRecoveryCode(plaintext[0], hashed)
    expect(remaining).toHaveLength(2)
    const secondAttempt = await consumeRecoveryCode(plaintext[0], remaining!)
    expect(secondAttempt).toBeNull()
  })
  it("lowercase input matches uppercase-stored code", async () => {
    const { plaintext, hashed } = await generateRecoveryCodes(2)
    const result = await consumeRecoveryCode(plaintext[0].toLowerCase(), hashed)
    expect(result).not.toBeNull()
  })
})
