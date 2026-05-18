import "server-only"
import { createDecipheriv } from "node:crypto"

// Phase 12 WS-C.1 internal — root-key unwrap helper, exposed only
// for credential-vault.ts rewrap path (which needs to load retired
// vault-kek versions). The same wrap format is used by
// lib/crypto-key.ts; if that file's format changes, update here too.
//
// Format: nonce(12) || ciphertext+tag

function rootKey(): Buffer {
  const raw = process.env.FLEETHUB_CRYPTO_ROOT_KEY?.trim()
  if (!raw) {
    throw new Error("FLEETHUB_CRYPTO_ROOT_KEY not configured")
  }
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) {
    throw new Error(`FLEETHUB_CRYPTO_ROOT_KEY must decode to 32 bytes; got ${buf.length}`)
  }
  return buf
}

export function unwrapMaterial(packed: Buffer): Buffer {
  if (packed.length < 12 + 16) {
    throw new Error("crypto-key-internal: packed material too short")
  }
  const nonce = packed.subarray(0, 12)
  const rest = packed.subarray(12)
  if (rest.length < 16) {
    throw new Error("crypto-key-internal: ciphertext too short to contain GCM tag")
  }
  const ct = rest.subarray(0, rest.length - 16)
  const tag = rest.subarray(rest.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", rootKey(), nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}
