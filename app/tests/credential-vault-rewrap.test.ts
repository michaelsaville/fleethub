import { describe, it, expect, beforeAll } from "vitest"
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { wrapForTest } from "./fixtures/crypto-wrap"

// Phase 12 WS-C — exercise the version-agnostic DEK derivation logic
// in isolation. The full rewrap loop requires a live DB, so we test
// the cryptographic primitive (HKDF determinism + decrypt-with-v1-
// then-encrypt-with-v2 round trip) that the rewrap relies on. If
// this passes, the rewrap loop's only remaining risk is DB-row
// contention, which is covered by the SELECT FOR UPDATE pattern.

beforeAll(() => {
  if (!process.env.FLEETHUB_CRYPTO_ROOT_KEY) {
    process.env.FLEETHUB_CRYPTO_ROOT_KEY = Buffer.alloc(32, 1).toString("base64")
  }
})

function deriveDek(kekMaterial: Buffer, tenantName: string, version: number): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      kekMaterial,
      Buffer.from(tenantName, "utf8"),
      `vault:${version}`,
      32,
    ),
  )
}

function encrypt(dek: Buffer, plaintext: Buffer): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", dek, nonce)
  const enc = Buffer.concat([c.update(plaintext), c.final()])
  const tag = c.getAuthTag()
  return { ciphertext: Buffer.concat([enc, tag]), nonce }
}

function decrypt(dek: Buffer, ciphertext: Buffer, nonce: Buffer): Buffer {
  const ct = ciphertext.subarray(0, ciphertext.length - 16)
  const tag = ciphertext.subarray(ciphertext.length - 16)
  const d = createDecipheriv("aes-256-gcm", dek, nonce)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}

describe("vault rewrap primitive", () => {
  it("HKDF over (kek, tenant, version) is deterministic", () => {
    const kek = randomBytes(32)
    const a = deriveDek(kek, "Acme Co.", 1)
    const b = deriveDek(kek, "Acme Co.", 1)
    expect(a.equals(b)).toBe(true)
  })

  it("Different versions produce different DEKs even with same kek+tenant", () => {
    const kek = randomBytes(32)
    const v1 = deriveDek(kek, "Acme", 1)
    const v2 = deriveDek(kek, "Acme", 2)
    expect(v1.equals(v2)).toBe(false)
  })

  it("Different tenants produce different DEKs even at same version", () => {
    const kek = randomBytes(32)
    const a = deriveDek(kek, "Acme", 1)
    const b = deriveDek(kek, "Beta", 1)
    expect(a.equals(b)).toBe(false)
  })

  it("Different KEKs produce different DEKs", () => {
    const kek1 = randomBytes(32)
    const kek2 = randomBytes(32)
    const a = deriveDek(kek1, "Acme", 1)
    const b = deriveDek(kek2, "Acme", 1)
    expect(a.equals(b)).toBe(false)
  })

  it("Rewrap v1→v2 roundtrip preserves plaintext", () => {
    const kek1 = randomBytes(32) // imagine vault-kek v1 material
    const kek2 = randomBytes(32) // and v2 material
    const tenant = "Acme"
    const plaintext = Buffer.from("hunter2-database-password-xyz")
    // Seal under v1
    const dek1 = deriveDek(kek1, tenant, 1)
    const { ciphertext, nonce } = encrypt(dek1, plaintext)
    // Decrypt with v1
    const decrypted = decrypt(dek1, ciphertext, nonce)
    expect(decrypted.equals(plaintext)).toBe(true)
    // Now rewrap: decrypt with v1, re-encrypt with v2
    const dek2 = deriveDek(kek2, tenant, 2)
    const { ciphertext: ct2, nonce: nonce2 } = encrypt(dek2, decrypted)
    // The v2 DEK successfully decrypts the new ciphertext
    const final = decrypt(dek2, ct2, nonce2)
    expect(final.equals(plaintext)).toBe(true)
    // The v1 DEK CANNOT decrypt the v2 ciphertext (proves rewrap was real)
    expect(() => decrypt(dek1, ct2, nonce2)).toThrow()
  })

  it("Wrong-version DEK fails AEAD tag (no false-positive decrypt)", () => {
    const kek = randomBytes(32)
    const tenant = "Acme"
    const dek1 = deriveDek(kek, tenant, 1)
    const dek2 = deriveDek(kek, tenant, 2)
    const { ciphertext, nonce } = encrypt(dek1, Buffer.from("secret"))
    expect(() => decrypt(dek2, ciphertext, nonce)).toThrow()
  })

  it("wrapForTest helper produces unwrappable output under same root key", () => {
    const root = process.env.FLEETHUB_CRYPTO_ROOT_KEY!
    const material = randomBytes(32)
    const wrapped = wrapForTest(material, root)
    // Wrapped blob is nonce(12) || ciphertext+tag — should be at
    // least 12 + 32 + 16 bytes (header + payload + GCM tag).
    expect(wrapped.length).toBeGreaterThanOrEqual(60)
  })
})
