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
 *  salt and a versioned info string. */
async function deriveTenantDek(
  tenantName: string,
  keyVersion: number,
): Promise<Buffer> {
  const kek = await getActiveKey("vault-kek")
  // v1 of Phase 11: only one vault-kek version exists. Rotation UI
  // is Phase 12 (PHASE-11-DESIGN.md §6). When a non-active version
  // is requested (rotation path), this throws — caller is then
  // explicitly responsible for the rotate-rewrap flow.
  if (kek.version !== keyVersion) {
    throw new Error(
      `vault: requested vault-kek v${keyVersion} but active is v${kek.version}. ` +
        `Multi-version DEK derivation not yet implemented (Phase 12).`,
    )
  }
  const dek = hkdfSync(
    "sha256",
    kek.material,
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
