import "server-only"
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { deriveProofKey, wrapProofKey } from "@/lib/agent-crypto"

// Phase 13 WS-D.0 — agent-enrollment helpers.
//
// Bootstrap flow:
//   1. Operator (ADMIN) POSTs /api/admin/enroll-tokens — server
//      creates Fl_EnrollToken with 64-char hex token + 24h default
//      TTL. Returns { token, expiresAt, bootstrapSnippetUnix,
//      bootstrapSnippetWindows }. Token is shown ONCE.
//   2. Agent runs `pcc2k-agent --bootstrap-token <token>
//      --bootstrap-url <fleethub-url>/api/agent-ingest/enroll` on
//      target host. POSTs { token, hostname, os, osVersion }.
//   3. Server validates (unused + unexpired), generates per-agent
//      secret (32-byte hex), bcrypts it, creates Fl_AgentRegistration,
//      marks token consumed, returns { agentId, agentSecret,
//      fleethubBaseUrl }. Plaintext secret returned ONCE.
//   4. Agent stores secret via OS keystore (DPAPI / keyring /
//      Keychain) and uses it on every subsequent posture / hello
//      call.
//
// Token re-use → 410-Gone. Token expiry → 410-Gone.

export const ENROLL_TOKEN_TTL_HOURS_DEFAULT = 24
export const ENROLL_TOKEN_TTL_HOURS_MAX = 24 * 7

export function generateEnrollToken(): string {
  return randomBytes(32).toString("hex")
}

export function generateAgentSecret(): string {
  return randomBytes(32).toString("hex")
}

/** Per-tenant long-lived enrollment key (see Fl_Tenant.enrollKey).
 *  40 lowercase hex chars — distinguishable from the 64-char one-time
 *  tokens by length alone, and legal inside a Windows filename. */
export const ENROLL_KEY_LENGTH = 40
export function generateEnrollKey(): string {
  return randomBytes(ENROLL_KEY_LENGTH / 2).toString("hex")
}
export function looksLikeEnrollKey(s: string): boolean {
  return /^[0-9a-f]{40}$/.test(s)
}
export function looksLikeEnrollToken(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s)
}

/** Everything the Install tab shows for a tenant key: the one-liners and
 *  the download URLs. All routes live under /install/k/<key>/… and are
 *  public — the key is the credential. */
export function buildKeyInstallLinks(key: string, fleethubBaseUrl: string) {
  const url = fleethubBaseUrl.replace(/\/$/, "")
  const base = `${url}/install/k/${key}`
  return {
    windowsOneLiner: `iwr -useb ${base}/pcc2k-agent.ps1 | iex`,
    unixOneLiner: `curl -fsSL ${base}/pcc2k-agent.sh | sudo bash`,
    windowsInstallerUrl: `${base}/pcc2k-agent-${key}.exe`,
    windowsInstallerName: `pcc2k-agent-${key}.exe`,
    scriptPs1Url: `${base}/pcc2k-agent.ps1`,
    scriptShUrl: `${base}/pcc2k-agent.sh`,
  }
}

export async function hashAgentSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10)
}

export async function verifyAgentSecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash)
}

export interface EnrollTokenInfo {
  token: string
  tenantName: string
  expiresAt: Date
  bootstrapSnippetUnix: string
  bootstrapSnippetWindows: string
}

export function buildBootstrapSnippets(
  token: string,
  fleethubBaseUrl: string,
): { unix: string; windows: string } {
  const url = fleethubBaseUrl.replace(/\/$/, "")
  const unix = [
    `curl -fsSL ${url}/install/bootstrap.sh \\`,
    `  | PCC2K_BOOTSTRAP_TOKEN=${token} \\`,
    `    PCC2K_FLEETHUB_URL=${url} \\`,
    `    sudo bash`,
  ].join("\n")
  const windows = [
    `$env:PCC2K_BOOTSTRAP_TOKEN = "${token}"`,
    `$env:PCC2K_FLEETHUB_URL = "${url}"`,
    `iwr -useb ${url}/install/bootstrap.ps1 | iex`,
  ].join("\n")
  return { unix, windows }
}

export interface ConsumeEnrollResult {
  ok: true
  agentId: string
  agentSecret: string
  fleethubBaseUrl: string
  /** WSS gateway URL the agent dials at runtime. Configured via
   *  PCC2K_GATEWAY_PUBLIC_URL env; defaults to the public gateway
   *  hostname pattern documented in AGENT-RUNBOOK §2. */
  gatewayUrl: string
  tenantName: string
}
export type ConsumeEnrollError =
  | { ok: false; reason: "not-found"; status: 404 }
  | { ok: false; reason: "expired"; status: 410 }
  | { ok: false; reason: "already-consumed"; status: 410 }

/** Atomically consume one use of a token + create Fl_AgentRegistration
 *  row. Race-safe via $queryRaw atomic UPDATE...RETURNING gated on
 *  useCount < maxUses AND expiresAt > NOW(). When the increment brings
 *  useCount up to maxUses, consumedAt is stamped in the same statement
 *  so single-use callers keep their existing semantics. */
export async function consumeEnrollToken(args: {
  token: string
  hostname: string | null
  os: string | null
  osVersion: string | null
  ip: string | null
}): Promise<ConsumeEnrollResult | ConsumeEnrollError> {
  const row = await prisma.fl_EnrollToken.findUnique({
    where: { token: args.token },
  })
  if (!row) return { ok: false, reason: "not-found", status: 404 }
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired", status: 410 }
  }
  if (row.useCount >= row.maxUses) {
    return { ok: false, reason: "already-consumed", status: 410 }
  }

  // Generate per-agent secret + create Fl_AgentRegistration.
  const agentSecret = generateAgentSecret()
  const agentSecretHash = await hashAgentSecret(agentSecret)

  // Atomic consume: increment useCount only if still under cap AND not
  // expired; stamp consumedAt the moment we hit maxUses; record the
  // most-recent enroll IP (multi-use tokens just keep the latest).
  const claimed = await prisma.$queryRaw<Array<{ token: string }>>`
    UPDATE fleethub.fl_enroll_tokens
       SET "useCount" = "useCount" + 1,
           "consumedAt" = CASE
             WHEN "useCount" + 1 >= "maxUses" THEN NOW()
             ELSE "consumedAt"
           END,
           "consumedFromIp" = ${args.ip ?? null}
     WHERE token = ${args.token}
       AND "useCount" < "maxUses"
       AND "expiresAt" > NOW()
     RETURNING token
  `
  if (claimed.length === 0) {
    return { ok: false, reason: "already-consumed", status: 410 }
  }

  const reg = await registerAgent({
    tenantName: row.tenantName,
    enrolledByToken: args.token,
    agentSecretHash,
    agentSecret,
    hostname: args.hostname,
    os: args.os,
    osVersion: args.osVersion,
  })

  // Backfill consumedByAgentId on the token row. For multi-use tokens
  // we keep the FIRST agent id that consumed it — the audit log
  // captures every subsequent enrollment under enroll-token.consumed
  // with the agentId in detail.
  await prisma.fl_EnrollToken.updateMany({
    where: { token: args.token, consumedByAgentId: null },
    data: { consumedByAgentId: reg.id },
  })

  const baseUrl = process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com"
  const gatewayUrl =
    process.env.PCC2K_GATEWAY_PUBLIC_URL?.trim() ||
    "wss://gateway.pcc2k.com/agent/v1"

  return {
    ok: true,
    agentId: reg.id,
    agentSecret,
    fleethubBaseUrl: baseUrl,
    gatewayUrl,
    tenantName: row.tenantName,
  }
}

/** Shared tail of every enrollment: the Fl_AgentRegistration row plus
 *  the opshub.op_agents bridge the WSS gateway looks up. */
async function registerAgent(args: {
  tenantName: string
  enrolledByToken: string
  agentSecret: string
  agentSecretHash: string
  hostname: string | null
  os: string | null
  osVersion: string | null
}) {
  const reg = await prisma.fl_AgentRegistration.create({
    data: {
      tenantName: args.tenantName,
      hostname: args.hostname ?? null,
      os: args.os ?? null,
      osVersion: args.osVersion ?? null,
      agentSecretHash: args.agentSecretHash,
      enrolledByToken: args.enrolledByToken,
    },
  })

  // Bridge to opshub.op_agents — what the WSS gateway looks up.
  // Without this row + proofKeyEnc the agent's session.proof fails
  // and the gateway falls through to dev-token mode (which is
  // disabled in prod). The cross-schema Op_Agent table predates
  // the Phase 13 enroll flow; this bridge is what makes the new
  // enroll path actually work end-to-end.
  //
  // proofKeyEnc = AES-GCM(deriveProofKey(agentSecret), masterKey).
  // The agent receives the plaintext agentSecret (as its "token"),
  // derives the same proofKey, and both sides match on the
  // session-challenge HMAC.
  const proofKeyEnc = wrapProofKey(deriveProofKey(args.agentSecret))
  await prisma.$executeRaw`
    INSERT INTO opshub.op_agents
      (id, "clientName", hostname, os, "secretHash", "capabilitiesJson",
       "isActive", "createdAt", "updatedAt", "proofKeyEnc", salt)
    VALUES (
      ${reg.id}, ${args.tenantName}, ${args.hostname ?? ""}, ${args.os ?? ""},
      ${args.agentSecretHash}, ${"[]"}::jsonb,
      true, NOW(), NOW(), ${proofKeyEnc}, ${randomBytes(16).toString("hex")}
    )
    ON CONFLICT (id) DO NOTHING
  `

  return reg
}

export type TenantKeyEnrollError = { ok: false; reason: "not-found" | "disabled"; status: 404 }

/** Enroll against a tenant's long-lived key. Nothing is consumed; the
 *  key is either valid or it isn't. Disabled keys and unknown keys both
 *  404 so a probe learns nothing. */
export async function enrollWithTenantKey(args: {
  key: string
  hostname: string | null
  os: string | null
  osVersion: string | null
}): Promise<ConsumeEnrollResult | TenantKeyEnrollError> {
  if (!looksLikeEnrollKey(args.key)) return { ok: false, reason: "not-found", status: 404 }
  const tenant = await prisma.fl_Tenant.findUnique({
    where: { enrollKey: args.key },
    select: { name: true, enrollKeyEnabled: true },
  })
  if (!tenant) return { ok: false, reason: "not-found", status: 404 }
  if (!tenant.enrollKeyEnabled) return { ok: false, reason: "disabled", status: 404 }

  const agentSecret = generateAgentSecret()
  const agentSecretHash = await hashAgentSecret(agentSecret)
  const reg = await registerAgent({
    tenantName: tenant.name,
    enrolledByToken: `key:${args.key.slice(0, 8)}`,
    agentSecret,
    agentSecretHash,
    hostname: args.hostname,
    os: args.os,
    osVersion: args.osVersion,
  })
  const baseUrl = process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com"
  const gatewayUrl =
    process.env.PCC2K_GATEWAY_PUBLIC_URL?.trim() || "wss://gateway.pcc2k.com/agent/v1"
  return {
    ok: true,
    agentId: reg.id,
    agentSecret,
    fleethubBaseUrl: baseUrl,
    gatewayUrl,
    tenantName: tenant.name,
  }
}

/** Resolve a tenant's key for the public /install/k/<key> routes. */
export async function tenantForEnrollKey(key: string): Promise<{ name: string } | null> {
  if (!looksLikeEnrollKey(key)) return null
  const t = await prisma.fl_Tenant.findUnique({
    where: { enrollKey: key },
    select: { name: true, enrollKeyEnabled: true },
  })
  return t && t.enrollKeyEnabled ? { name: t.name } : null
}
