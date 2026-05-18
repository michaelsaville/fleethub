import "server-only"
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

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
  tenantName: string
}
export type ConsumeEnrollError =
  | { ok: false; reason: "not-found"; status: 404 }
  | { ok: false; reason: "expired"; status: 410 }
  | { ok: false; reason: "already-consumed"; status: 410 }

/** Atomically consume a token + create Fl_AgentRegistration row.
 *  Race-safe via updateMany WHERE consumedAt IS NULL. */
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
  if (row.consumedAt != null) {
    return { ok: false, reason: "already-consumed", status: 410 }
  }

  // Generate per-agent secret + create Fl_AgentRegistration.
  const agentSecret = generateAgentSecret()
  const agentSecretHash = await hashAgentSecret(agentSecret)

  // Race-safe: only consume if still unconsumed.
  const updated = await prisma.fl_EnrollToken.updateMany({
    where: { token: args.token, consumedAt: null },
    data: { consumedAt: new Date(), consumedFromIp: args.ip ?? null },
  })
  if (updated.count === 0) {
    return { ok: false, reason: "already-consumed", status: 410 }
  }

  const reg = await prisma.fl_AgentRegistration.create({
    data: {
      tenantName: row.tenantName,
      hostname: args.hostname ?? null,
      os: args.os ?? null,
      osVersion: args.osVersion ?? null,
      agentSecretHash,
      enrolledByToken: args.token,
    },
  })

  // Backfill consumedByAgentId on the token row.
  await prisma.fl_EnrollToken.update({
    where: { token: args.token },
    data: { consumedByAgentId: reg.id },
  })

  const baseUrl = process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com"

  return {
    ok: true,
    agentId: reg.id,
    agentSecret,
    fleethubBaseUrl: baseUrl,
    tenantName: row.tenantName,
  }
}
