import "server-only"

// Phase 8 Workstream B — shared types + helpers for posture ingest.
// Both /api/agent/posture/backup and /api/agent/posture/av speak the
// same auth shape (Bearer FLEETHUB_AGENT_SECRET) and look up the
// target device by (clientName, hostname) the same way.

export const BACKUP_PRODUCTS = new Set([
  "veeam", "datto", "restic", "windows-backup", "macos-tm", "none",
])
export const AV_ENGINES = new Set([
  "defender", "crowdstrike", "sophos", "sentinelone", "bitdefender", "none",
])

export interface DeviceLookup {
  id: string
  clientName: string
  hostname: string
}

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; reason: string }

export function checkAgentAuth(header: string | null): AuthResult {
  const secret = process.env.FLEETHUB_AGENT_SECRET ?? ""
  if (!secret) return { ok: false, status: 500, reason: "FLEETHUB_AGENT_SECRET not configured" }
  if (!header || header !== `Bearer ${secret}`) {
    return { ok: false, status: 401, reason: "unauthorized" }
  }
  return { ok: true }
}
