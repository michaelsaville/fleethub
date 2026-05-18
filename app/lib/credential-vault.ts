import "server-only"
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { getActiveKey } from "@/lib/crypto-key"

// Phase 11 WS-A.4 — credential vault. Symmetric encryption-at-rest
// per tenant, with the operator-disclose path gated on step-up auth
// (WS-C.5) and 4-eyes approval when the tenant policy demands it.
//
// Key hierarchy:
//   FLEETHUB_CRYPTO_ROOT_KEY (env)
//     → wraps Fl_CryptoKey purpose='vault-kek'
//        → derives per-tenant DEK via HKDF-SHA256(vault-kek,
//           salt=tenantName, info=`vault:${keyVersion}`)
//           → AES-256-GCM encrypts Fl_Credential.ciphertext
//
// The DEK is deterministic from (vault-kek, tenantName, keyVersion),
// so any FleetHub process with the same root key arrives at the
// same DEK without coordination.

export type CredentialKind =
  | "admin-pw"
  | "api-key"
  | "wifi-psk"
  | "snmp-v3"
  | "smtp-password"
  | "webhook-secret"
  | "other"

const CIPHER = "aes-256-gcm"
const DEK_LEN = 32

/** Per-tenant DEK derivation. Deterministic — same inputs always
 *  return the same key bytes. Uses HKDF-SHA256 with tenantName as
 *  salt and a versioned info string. Default path uses the ACTIVE
 *  vault-kek version; refuses non-active versions. For the rewrap
 *  path, use deriveTenantDekForVersion which takes an explicit
 *  version + loads even retired keys. */
async function deriveTenantDek(
  tenantName: string,
  keyVersion: number,
): Promise<Buffer> {
  const kek = await getActiveKey("vault-kek")
  if (kek.version !== keyVersion) {
    throw new Error(
      `vault: requested vault-kek v${keyVersion} but active is v${kek.version}. ` +
        `Use deriveTenantDekForVersion() for the rewrap path.`,
    )
  }
  return hkdfDek(kek.material, tenantName, keyVersion)
}

/** Phase 12 WS-C.1 — explicit-version DEK derivation. Loads the
 *  Fl_CryptoKey row at the requested version (active OR retired)
 *  and derives. Used by rewrapTenantCredentials in the rotate path
 *  where v1 must be decrypted then v2 re-encrypted. */
export async function deriveTenantDekForVersion(
  tenantName: string,
  keyVersion: number,
): Promise<Buffer> {
  // Reach into Fl_CryptoKey directly for the row at this version.
  // We can't go through getActiveKey because retired versions are
  // intentionally not "active".
  const row = await prisma.fl_CryptoKey.findFirst({
    where: { purpose: "vault-kek", version: keyVersion },
  })
  if (!row) {
    throw new Error(
      `vault: no vault-kek row at version=${keyVersion}; rewrap impossible`,
    )
  }
  // Unwrap with the same root-key crypto crypto-key.ts uses. We import
  // the un-exported helper via a tiny re-implementation — the wrap
  // format is documented + stable (12-byte nonce || ciphertext+tag).
  const { unwrapMaterial } = await import("./crypto-key-internal")
  const material = unwrapMaterial(Buffer.from(row.keyMaterial))
  return hkdfDek(material, tenantName, keyVersion)
}

function hkdfDek(kekMaterial: Buffer, tenantName: string, keyVersion: number): Buffer {
  const dek = hkdfSync(
    "sha256",
    kekMaterial,
    Buffer.from(tenantName, "utf8"),
    `vault:${keyVersion}`,
    DEK_LEN,
  )
  return Buffer.from(dek)
}

// ─── Internal encrypt/decrypt with a DEK ───────────────────────────────────

function encryptWithDek(
  dek: Buffer,
  plaintext: Buffer,
): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12)
  const cipher = createCipheriv(CIPHER, dek, nonce)
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { ciphertext: Buffer.concat([enc, tag]), nonce }
}

function decryptWithDek(
  dek: Buffer,
  ciphertext: Buffer,
  nonce: Buffer,
): Buffer {
  if (ciphertext.length < 16) {
    throw new Error("vault: ciphertext too short to contain GCM tag")
  }
  const ct = ciphertext.subarray(0, ciphertext.length - 16)
  const tag = ciphertext.subarray(ciphertext.length - 16)
  const decipher = createDecipheriv(CIPHER, dek, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

// ─── Public API ────────────────────────────────────────────────────────────

export type SealInput = {
  tenantName: string
  kind: CredentialKind
  label: string
  plaintext: string
  createdBy: string
  rotateBy?: Date | null
}

export type SealResult = {
  id: string
  keyVersion: number
}

/** Encrypt a plaintext under the active vault-kek and persist as a
 *  Fl_Credential row. Returns the new id. Does NOT write an audit
 *  row — caller (route handler) wraps with withAudit + redactKeys. */
export async function seal(input: SealInput): Promise<SealResult> {
  const kek = await getActiveKey("vault-kek")
  const dek = await deriveTenantDek(input.tenantName, kek.version)
  const { ciphertext, nonce } = encryptWithDek(
    dek,
    Buffer.from(input.plaintext, "utf8"),
  )
  const row = await prisma.fl_Credential.create({
    data: {
      tenantName: input.tenantName,
      kind: input.kind,
      label: input.label,
      ciphertext: new Uint8Array(ciphertext),
      nonce: new Uint8Array(nonce),
      keyVersion: kek.version,
      rotateBy: input.rotateBy ?? null,
      createdBy: input.createdBy,
    },
  })
  return { id: row.id, keyVersion: row.keyVersion }
}

export type UnsealForSystemInput = {
  credentialId: string
  /// "system:alert-channels", "system:snmp-poller", "system:scheduled-task"
  context: string
}

export type UnsealResult = {
  plaintext: string
  tenantName: string
  kind: CredentialKind
  label: string
}

/** Server-internal disclose path — no step-up required because the
 *  caller IS the server itself (alert dispatcher resolving a Slack
 *  webhook, future SNMP poller resolving a community string).
 *  Writes a Fl_CredentialDisclosureLog row tagged with the context.
 *  Use ONLY from server-side adapters; operator paths use unseal(). */
export async function unsealForSystemUse(
  input: UnsealForSystemInput,
): Promise<UnsealResult> {
  const row = await prisma.fl_Credential.findFirst({
    where: { id: input.credentialId, replacedAt: null },
  })
  if (!row) {
    throw new Error(`vault: credential ${input.credentialId} not found or replaced`)
  }
  const dek = await deriveTenantDek(row.tenantName, row.keyVersion)
  const plaintext = decryptWithDek(
    dek,
    Buffer.from(row.ciphertext),
    Buffer.from(row.nonce),
  )
  // Best-effort touch + audit. Failure here doesn't fail the unseal
  // (alert dispatch must not be blocked by a log-row write).
  await Promise.all([
    prisma.fl_Credential.update({
      where: { id: row.id },
      data: { lastAccessedAt: new Date() },
    }),
    prisma.fl_CredentialDisclosureLog.create({
      data: {
        credentialId: row.id,
        viewedBy: input.context,
        justification: input.context,
        context: input.context,
      },
    }),
  ]).catch((err) => {
    console.error("[vault] disclosure log write failed (non-fatal)", err)
  })
  return {
    plaintext: plaintext.toString("utf8"),
    tenantName: row.tenantName,
    kind: row.kind as CredentialKind,
    label: row.label,
  }
}

export type UnsealForOperatorInput = {
  credentialId: string
  actorEmail: string
  justification: string
  ip?: string | null
  userAgent?: string | null
  /// "ui-disclose" | "ui-copy-to-clipboard"
  context: string
}

/** Operator-facing disclose path. Caller MUST have already verified
 *  the step-up token AND (if tenant policy demands) the 4-eyes
 *  approval — this module does NOT enforce those gates, it just
 *  decrypts. The disclose ROUTE (WS-A.7) is the policy enforcement
 *  point and wraps this with the gates. Writes the disclosure log
 *  with operator context. */
export async function unseal(
  input: UnsealForOperatorInput,
): Promise<UnsealResult> {
  const row = await prisma.fl_Credential.findFirst({
    where: { id: input.credentialId, replacedAt: null },
  })
  if (!row) {
    throw new Error(`vault: credential ${input.credentialId} not found or replaced`)
  }
  const dek = await deriveTenantDek(row.tenantName, row.keyVersion)
  const plaintext = decryptWithDek(
    dek,
    Buffer.from(row.ciphertext),
    Buffer.from(row.nonce),
  )
  await prisma.$transaction([
    prisma.fl_Credential.update({
      where: { id: row.id },
      data: { lastAccessedAt: new Date() },
    }),
    prisma.fl_CredentialDisclosureLog.create({
      data: {
        credentialId: row.id,
        viewedBy: input.actorEmail,
        justification: input.justification,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        context: input.context,
      },
    }),
  ])
  return {
    plaintext: plaintext.toString("utf8"),
    tenantName: row.tenantName,
    kind: row.kind as CredentialKind,
    label: row.label,
  }
}

export type RotateInput = {
  credentialId: string
  newPlaintext: string
  actorEmail: string
}

/** Rotate a credential to a new plaintext. The current row is
 *  marked `replacedAt`; a new row is inserted with the same label
 *  + kind + tenantName + the new plaintext. Both rows remain for
 *  forensic / disclosure-history continuity. */
export async function rotate(input: RotateInput): Promise<SealResult> {
  const old = await prisma.fl_Credential.findFirst({
    where: { id: input.credentialId, replacedAt: null },
  })
  if (!old) {
    throw new Error(`vault: credential ${input.credentialId} not found or already replaced`)
  }
  const kek = await getActiveKey("vault-kek")
  const dek = await deriveTenantDek(old.tenantName, kek.version)
  const { ciphertext, nonce } = encryptWithDek(
    dek,
    Buffer.from(input.newPlaintext, "utf8"),
  )
  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.fl_Credential.create({
      data: {
        tenantName: old.tenantName,
        kind: old.kind,
        label: old.label,
        ciphertext: new Uint8Array(ciphertext),
        nonce: new Uint8Array(nonce),
        keyVersion: kek.version,
        rotateBy: old.rotateBy,
        createdBy: input.actorEmail,
      },
    })
    await tx.fl_Credential.update({
      where: { id: old.id },
      data: { replacedAt: new Date() },
    })
    return next
  })
  return { id: created.id, keyVersion: created.keyVersion }
}


// ─── PHASE 12 WS-C — VAULT REWRAP (KEK rotation) ────────────────────────────

export interface RewrapProgress {
  processed: number
  total: number
  currentTenant: string | null
}

export interface RewrapInput {
  fromVersion: number
  toVersion: number
  /** Called after each batch; total is set at start. */
  onProgress?: (p: RewrapProgress) => void
}

const REWRAP_BATCH_SIZE = 100

/** Phase 12 WS-C.2 — re-encrypt every active Fl_Credential row under
 *  the new vault-kek version. Per-row $transaction with SELECT FOR
 *  UPDATE so a concurrent unseal blocks until row settles. Resumes
 *  cleanly if interrupted — already-rewrapped rows (keyVersion ==
 *  toVersion) are skipped. Pure-server. */
export async function rewrapTenantCredentials(input: RewrapInput): Promise<RewrapProgress> {
  const total = await prisma.fl_Credential.count({
    where: { replacedAt: null, keyVersion: input.fromVersion },
  })
  let processed = 0
  let currentTenant: string | null = null
  while (true) {
    const batch = await prisma.fl_Credential.findMany({
      where: { replacedAt: null, keyVersion: input.fromVersion },
      orderBy: [{ tenantName: "asc" }, { createdAt: "asc" }],
      take: REWRAP_BATCH_SIZE,
    })
    if (batch.length === 0) break
    for (const row of batch) {
      currentTenant = row.tenantName
      // Per-row transaction with FOR UPDATE so any concurrent
      // unsealForSystemUse() blocks until the rewrap settles.
      await prisma.$transaction(async (tx) => {
        // Re-read with FOR UPDATE.
        const locked = await tx.$queryRaw<{ id: string; nonce: Buffer; ciphertext: Buffer; keyVersion: number }[]>`
          SELECT id, nonce, ciphertext, "keyVersion"
          FROM fleethub.fl_credentials
          WHERE id = ${row.id} AND "replacedAt" IS NULL
          FOR UPDATE
        `
        if (locked.length === 0) return
        const r = locked[0]
        if (r.keyVersion !== input.fromVersion) return // someone else rewrapped already
        // Decrypt with the OLD DEK.
        const oldDek = await deriveTenantDekForVersion(row.tenantName, input.fromVersion)
        const plaintext = decryptWithDek(
          oldDek,
          Buffer.from(r.ciphertext),
          Buffer.from(r.nonce),
        )
        // Re-encrypt with the NEW DEK.
        const newDek = await deriveTenantDekForVersion(row.tenantName, input.toVersion)
        const { ciphertext: ct2, nonce: nonce2 } = encryptWithDek(newDek, plaintext)
        await tx.fl_Credential.update({
          where: { id: r.id },
          data: {
            ciphertext: new Uint8Array(ct2),
            nonce: new Uint8Array(nonce2),
            keyVersion: input.toVersion,
          },
        })
        // Best-effort clear plaintext buffer.
        plaintext.fill(0)
      })
      processed++
    }
    input.onProgress?.({ processed, total, currentTenant })
  }
  return { processed, total, currentTenant }
}
