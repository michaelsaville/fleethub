import { createCipheriv, randomBytes } from "node:crypto"

// Phase 11 WS-E.6 test fixture. Mirrors the wrap shape that
// lib/crypto-key.ts uses internally so test code can produce a
// wrapped material blob for the mocked Fl_CryptoKey row.
//
// Format: nonce(12) || ciphertext+tag

export function wrapForTest(plaintext: Buffer, rootKeyB64: string): Buffer {
  const root = Buffer.from(rootKeyB64, "base64")
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", root, nonce)
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, enc, tag])
}
