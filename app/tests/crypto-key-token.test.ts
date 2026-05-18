import { describe, it, expect, beforeAll, vi } from "vitest"

// Phase 11 WS-E.6 — pure-token coverage. signApprovalToken /
// verifyApprovalToken / mintStepUpToken / verifyStepUpToken all
// route through getActiveKey() which hits the DB; for unit tests we
// mock that one call to return a fixed HMAC key and exercise the
// signature + replay + expiry logic.

beforeAll(() => {
  if (!process.env.FLEETHUB_CRYPTO_ROOT_KEY) {
    // 32 bytes base64
    process.env.FLEETHUB_CRYPTO_ROOT_KEY = Buffer.alloc(32, 1).toString("base64")
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fl_CryptoKey: {
      findFirst: vi.fn().mockResolvedValue({
        id: "fake-key-id",
        purpose: "approval-signing",
        algorithm: "hmac-sha256",
        // Pre-wrapped material under the fixed root key. Generated
        // in-test below via wrapForTest helper to keep the test
        // self-contained.
        keyMaterial: Buffer.alloc(0),
        publicKey: null,
        version: 1,
      }),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// We can't easily mock the wrap/unwrap because crypto-key.ts uses
// the same module's primitives. Instead, intercept via an alternate
// path: pre-generate a properly-wrapped key and inject into the
// findFirst mock body.

import { wrapForTest } from "./fixtures/crypto-wrap"
import * as ckm from "../lib/crypto-key"
import { prisma } from "@/lib/prisma"

describe("approval token sign/verify", () => {
  beforeAll(() => {
    const material = Buffer.alloc(32, 7)
    const wrapped = wrapForTest(material, process.env.FLEETHUB_CRYPTO_ROOT_KEY!)
    ;(prisma.fl_CryptoKey.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fake-key-id",
      purpose: "approval-signing",
      algorithm: "hmac-sha256",
      keyMaterial: wrapped,
      publicKey: null,
      version: 1,
    })
    ckm.invalidateKeyCache()
  })

  it("roundtrip succeeds", async () => {
    const token = await ckm.signApprovalToken({
      approvalId: "appr-1",
      payloadHash: "abc123",
      expMs: Date.now() + 60_000,
    })
    const verified = await ckm.verifyApprovalToken(token)
    expect(verified.ok).toBe(true)
    if (verified.ok) {
      expect(verified.payload.approvalId).toBe("appr-1")
      expect(verified.payload.payloadHash).toBe("abc123")
    }
  })

  it("tampered token (mutated middle byte) fails", async () => {
    const token = await ckm.signApprovalToken({
      approvalId: "appr-2",
      payloadHash: "abc",
      expMs: Date.now() + 60_000,
    })
    const decoded = Buffer.from(token, "base64url").toString("utf8")
    const flipped = decoded.replace("appr-2", "appr-9")
    const tampered = Buffer.from(flipped).toString("base64url")
    const verified = await ckm.verifyApprovalToken(tampered)
    expect(verified.ok).toBe(false)
  })

  it("expired token rejected", async () => {
    const token = await ckm.signApprovalToken({
      approvalId: "appr-3",
      payloadHash: "abc",
      expMs: Date.now() - 1000,
    })
    const verified = await ckm.verifyApprovalToken(token)
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.reason).toBe("expired")
  })

  it("malformed token rejected", async () => {
    const verified = await ckm.verifyApprovalToken("not.a.valid.token")
    expect(verified.ok).toBe(false)
  })
})

describe("step-up token sign/verify", () => {
  beforeAll(() => {
    const material = Buffer.alloc(32, 9)
    const wrapped = wrapForTest(material, process.env.FLEETHUB_CRYPTO_ROOT_KEY!)
    ;(prisma.fl_CryptoKey.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "stepup-key",
      purpose: "step-up-signing",
      algorithm: "hmac-sha256",
      keyMaterial: wrapped,
      publicKey: null,
      version: 1,
    })
    ckm.invalidateKeyCache()
  })

  it("mint+verify roundtrip", async () => {
    const token = await ckm.mintStepUpToken("user-42")
    const verified = await ckm.verifyStepUpToken(token)
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(verified.payload.userId).toBe("user-42")
  })

  it("each mint has a unique jti (replay-guard primitive)", async () => {
    const a = await ckm.mintStepUpToken("user-42")
    const b = await ckm.mintStepUpToken("user-42")
    expect(a).not.toBe(b)
    const va = await ckm.verifyStepUpToken(a)
    const vb = await ckm.verifyStepUpToken(b)
    if (va.ok && vb.ok) expect(va.payload.jti).not.toBe(vb.payload.jti)
  })

  it("default TTL is short (~5 minutes)", async () => {
    const before = Date.now()
    const token = await ckm.mintStepUpToken("user-42")
    const verified = await ckm.verifyStepUpToken(token)
    if (verified.ok) {
      const ttl = verified.payload.expMs - before
      expect(ttl).toBeGreaterThan(60_000) // > 1 min
      expect(ttl).toBeLessThan(10 * 60_000) // < 10 min
    }
  })
})
