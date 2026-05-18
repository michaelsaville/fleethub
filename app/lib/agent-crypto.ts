import "server-only"
import { createCipheriv, createHmac, randomBytes } from "node:crypto"

// MUST stay byte-identical with pcc2k-gateway/src/agent-crypto.mjs.
// The gateway wraps proofKeyEnc, FleetHub-side enroll mirrors the
// wrap so the gateway can unwrap. Drift = no agent can connect.
//
// Protocol:
//   token         — agent-side bearer secret. We don't store it.
//   proofKey      — HMAC(token, "pcc2k.proof.v1"). Used in the
//                   challenge-proof handshake.
//   proofKeyEnc   — AES-256-GCM(proofKey, masterKey). What we
//                   actually persist in Op_Agent.proofKeyEnc. Wire
//                   format: nonce(12) || ciphertext || tag(16),
//                   base64-encoded.

const PROTOCOL_INFO = "pcc2k.proof.v1"
const NONCE_BYTES = 12

export function getMasterKey(): Buffer {
  const hex = process.env.PCC2K_AGENT_MASTER_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      "PCC2K_AGENT_MASTER_KEY must be 32 bytes hex (openssl rand -hex 32)",
    )
  }
  return Buffer.from(hex, "hex")
}

export function deriveProofKey(token: string): Buffer {
  return createHmac("sha256", token).update(PROTOCOL_INFO).digest()
}

export function wrapProofKey(proofKey: Buffer): string {
  const key = getMasterKey()
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  const ct = Buffer.concat([cipher.update(proofKey), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ct, tag]).toString("base64")
}
