import "server-only"
import { createCipheriv, createDecipheriv, createHmac, randomBytes, generateKeyPairSync, timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"

// Phase 11 WS-A — single source of truth for every server-side
// secret. Five purposes today:
//
//   vault-kek         — symmetric key that wraps per-tenant DEKs
//   approval-signing  — HMAC; signs 4-eyes approval tokens (WS-B)
//   step-up-signing   — HMAC; signs WebAuthn/MFA step-up tokens (WS-C)
//   ack-signing       — HMAC; signs Phase 7 alert-ack URLs (migrated)
//   webauthn-rp       — Ed25519 keypair; RP identity for WebAuthn
//
// Rotation = insert new row at version+1, retire the old. Reads
// always use the highest-version non-retired row. Symmetric/HMAC
// keys are wrapped (AES-256-GCM) by FLEETHUB_CRYPTO_ROOT_KEY before
// hitting Postgres; the root key is loaded from env at boot and
// never persisted.

export type KeyPurpose =
  | "vault-kek"
  | "approval-signing"
  | "step-up-signing"
  | "ack-signing"
  | "webauthn-rp"

export type CryptoKeyAlgorithm = "aes-256-gcm" | "hmac-sha256" | "ed25519"

const PURPOSE_ALG: Record<KeyPurpose, CryptoKeyAlgorithm> = {
  "vault-kek": "aes-256-gcm",
  "approval-signing": "hmac-sha256",
  "step-up-signing": "hmac-sha256",
  "ack-signing": "hmac-sha256",
  "webauthn-rp": "ed25519",
}

// Root-key cache. Loaded once per process; if the env is missing,
// every call that needs it throws. We don't keep a default — losing
// this key is the unrecoverable failure mode by design.
let cachedRoot: Buffer | null = null

function rootKey(): Buffer {
  if (cachedRoot) return cachedRoot
  const raw = process.env.FLEETHUB_CRYPTO_ROOT_KEY?.trim()
  if (!raw) {
    throw new Error(
      "FLEETHUB_CRYPTO_ROOT_KEY not configured — Phase 11 crypto cannot bootstrap. See PHASE-11-DESIGN.md §6.",
    )
  }
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) {
    throw new Error(
      `FLEETHUB_CRYPTO_ROOT_KEY must decode to 32 bytes; got ${buf.length}. Regenerate with: openssl rand -base64 32`,
    )
  }
  cachedRoot = buf
  return buf
}

// ─── Root-key wrap / unwrap ────────────────────────────────────────────────

type Wrapped = { nonce: Buffer; ciphertext: Buffer }

function wrapWithRoot(plaintext: Buffer): Wrapped {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", rootKey(), nonce)
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { nonce, ciphertext: Buffer.concat([enc, tag]) }
}

function unwrapWithRoot(wrapped: Wrapped): Buffer {
  // Last 16 bytes of ciphertext are the GCM tag.
  if (wrapped.ciphertext.length < 16) {
    throw new Error("crypto-key: wrapped ciphertext too short")
  }
  const ct = wrapped.ciphertext.subarray(0, wrapped.ciphertext.length - 16)
  const tag = wrapped.ciphertext.subarray(wrapped.ciphertext.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", rootKey(), wrapped.nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

// keyMaterial in Fl_CryptoKey is `nonce(12) || ciphertext+tag`. One
// blob keeps the schema simple; if we ever migrate to KMS the seam
// is here.
function packWrapped(w: Wrapped): Buffer {
  return Buffer.concat([w.nonce, w.ciphertext])
}

function unpackWrapped(packed: Buffer): Wrapped {
  if (packed.length < 12 + 16) {
    throw new Error("crypto-key: packed material too short")
  }
  return {
    nonce: packed.subarray(0, 12),
    ciphertext: packed.subarray(12),
  }
}

// ─── Active-key loader (in-process cache) ──────────────────────────────────

type ActiveKey = {
  id: string
  purpose: KeyPurpose
  algorithm: CryptoKeyAlgorithm
  version: number
  // For symmetric/HMAC purposes, this is the raw key bytes (unwrapped).
  // For webauthn-rp, this is the raw private key bytes (unwrapped).
  material: Buffer
  // For webauthn-rp, the raw public key bytes. Null for symmetric/HMAC.
  publicKey: Buffer | null
}

const cache = new Map<KeyPurpose, ActiveKey>()

/** Load (or refresh) the active key for a purpose. */
export async function getActiveKey(purpose: KeyPurpose): Promise<ActiveKey> {
  const cached = cache.get(purpose)
  if (cached) return cached
  const row = await prisma.fl_CryptoKey.findFirst({
    where: { purpose, retiredAt: null },
    orderBy: { version: "desc" },
  })
  if (!row) {
    throw new Error(
      `crypto-key: no active key for purpose='${purpose}'. ` +
        `Run scripts/bootstrap-crypto-keys.ts (PHASE-11-DESIGN.md §6).`,
    )
  }
  const wrapped = unpackWrapped(Buffer.from(row.keyMaterial))
  const material = unwrapWithRoot(wrapped)
  const active: ActiveKey = {
    id: row.id,
    purpose,
    algorithm: row.algorithm as CryptoKeyAlgorithm,
    version: row.version,
    material,
    publicKey: row.publicKey ? Buffer.from(row.publicKey) : null,
  }
  cache.set(purpose, active)
  return active
}

/** Drop the in-process cache for a purpose. Call after rotate. */
export function invalidateKeyCache(purpose?: KeyPurpose): void {
  if (purpose) cache.delete(purpose)
  else cache.clear()
}

// ─── Bootstrap / rotate ────────────────────────────────────────────────────

function generatePurposeMaterial(purpose: KeyPurpose): {
  material: Buffer
  publicKey: Buffer | null
} {
  switch (PURPOSE_ALG[purpose]) {
    case "aes-256-gcm":
      return { material: randomBytes(32), publicKey: null }
    case "hmac-sha256":
      return { material: randomBytes(32), publicKey: null }
    case "ed25519": {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519")
      const priv = privateKey.export({ format: "der", type: "pkcs8" })
      const pub = publicKey.export({ format: "der", type: "spki" })
      return { material: Buffer.from(priv), publicKey: Buffer.from(pub) }
    }
  }
}

/** Insert a new Fl_CryptoKey row for a purpose. Bumps version
 *  if a key already exists; sets retiredAt on the prior active
 *  row when bumping. Audits via the caller — this function does
 *  not write the audit row (keeps the module audit-agnostic). */
export async function createKey(
  purpose: KeyPurpose,
  createdBy: string,
  notes?: string,
): Promise<{ id: string; version: number }> {
  const prior = await prisma.fl_CryptoKey.findFirst({
    where: { purpose },
    orderBy: { version: "desc" },
  })
  const nextVersion = (prior?.version ?? 0) + 1
  const { material, publicKey } = generatePurposeMaterial(purpose)
  const wrapped = packWrapped(wrapWithRoot(material))
  const created = await prisma.$transaction(async (tx) => {
    if (prior && prior.retiredAt == null) {
      await tx.fl_CryptoKey.update({
        where: { id: prior.id },
        data: { retiredAt: new Date() },
      })
    }
    return tx.fl_CryptoKey.create({
      data: {
        purpose,
        algorithm: PURPOSE_ALG[purpose],
        // Prisma 6 wants Uint8Array for Bytes; Buffer extends it but
        // the typed-decoded narrowing drops the variance, so coerce.
        keyMaterial: new Uint8Array(wrapped),
        publicKey: publicKey ? new Uint8Array(publicKey) : null,
        version: nextVersion,
        createdBy,
        notes: notes ?? null,
      },
    })
  })
  cache.delete(purpose)
  return { id: created.id, version: created.version }
}

// ─── HMAC token shapes (approval-signing / step-up-signing / ack) ──────────

/** Compute HMAC-SHA256 hex over message using the active key for
 *  the given HMAC purpose. */
async function hmacHexForPurpose(
  purpose: "approval-signing" | "step-up-signing" | "ack-signing",
  message: string,
): Promise<string> {
  const key = await getActiveKey(purpose)
  if (key.algorithm !== "hmac-sha256") {
    throw new Error(`crypto-key: purpose '${purpose}' is not HMAC`)
  }
  return createHmac("sha256", key.material).update(message).digest("hex")
}

function safeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}

// ─── Approval token (WS-B) ─────────────────────────────────────────────────

export type ApprovalTokenPayload = {
  approvalId: string
  payloadHash: string
  expMs: number
}

/** Mint a signed approval token. Embedded in the /approvals UI
 *  approve button's POST body so the dispatch path can verify
 *  the approval still matches the original payload. */
export async function signApprovalToken(
  p: ApprovalTokenPayload,
): Promise<string> {
  const msg = `${p.approvalId}.${p.payloadHash}.${p.expMs}`
  const sig = await hmacHexForPurpose("approval-signing", msg)
  // base64 the whole thing for compact URL embedding
  return Buffer.from(`${msg}.${sig}`).toString("base64url")
}

export type VerifyApprovalResult =
  | { ok: true; payload: ApprovalTokenPayload }
  | { ok: false; reason: string }

export async function verifyApprovalToken(
  token: string,
): Promise<VerifyApprovalResult> {
  let raw: string
  try {
    raw = Buffer.from(token, "base64url").toString("utf8")
  } catch {
    return { ok: false, reason: "malformed" }
  }
  const parts = raw.split(".")
  if (parts.length !== 4) return { ok: false, reason: "malformed" }
  const [approvalId, payloadHash, expMsStr, sig] = parts
  const expMs = parseInt(expMsStr, 10)
  if (!Number.isFinite(expMs)) return { ok: false, reason: "invalid exp" }
  if (Date.now() > expMs) return { ok: false, reason: "expired" }
  const msg = `${approvalId}.${payloadHash}.${expMsStr}`
  let expected: string
  try {
    expected = await hmacHexForPurpose("approval-signing", msg)
  } catch {
    return { ok: false, reason: "server not configured" }
  }
  if (!safeEqHex(expected, sig)) return { ok: false, reason: "signature mismatch" }
  return { ok: true, payload: { approvalId, payloadHash, expMs } }
}

// ─── Step-up token (WS-C) ──────────────────────────────────────────────────

export type StepUpTokenPayload = {
  userId: string
  jti: string
  expMs: number
}

/** Mint a single-use step-up token. Consumed by reading
 *  Fl_StepUpConsumed for `jti`; the consume path is in
 *  lib/step-up.ts (WS-C.5). */
export async function mintStepUpToken(
  userId: string,
  ttlMs: number = 5 * 60_000,
): Promise<string> {
  const jti = randomBytes(16).toString("hex")
  const expMs = Date.now() + ttlMs
  const msg = `${userId}.${jti}.${expMs}`
  const sig = await hmacHexForPurpose("step-up-signing", msg)
  return Buffer.from(`${msg}.${sig}`).toString("base64url")
}

export type VerifyStepUpResult =
  | { ok: true; payload: StepUpTokenPayload }
  | { ok: false; reason: string }

export async function verifyStepUpToken(
  token: string,
): Promise<VerifyStepUpResult> {
  let raw: string
  try {
    raw = Buffer.from(token, "base64url").toString("utf8")
  } catch {
    return { ok: false, reason: "malformed" }
  }
  const parts = raw.split(".")
  if (parts.length !== 4) return { ok: false, reason: "malformed" }
  const [userId, jti, expMsStr, sig] = parts
  const expMs = parseInt(expMsStr, 10)
  if (!Number.isFinite(expMs)) return { ok: false, reason: "invalid exp" }
  if (Date.now() > expMs) return { ok: false, reason: "expired" }
  const msg = `${userId}.${jti}.${expMsStr}`
  let expected: string
  try {
    expected = await hmacHexForPurpose("step-up-signing", msg)
  } catch {
    return { ok: false, reason: "server not configured" }
  }
  if (!safeEqHex(expected, sig)) return { ok: false, reason: "signature mismatch" }
  return { ok: true, payload: { userId, jti, expMs } }
}

// ─── Re-exports for callers ────────────────────────────────────────────────

export type { ActiveKey }
export { rootKey as __rootKeyForTesting }
