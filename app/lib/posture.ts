import "server-only"

// Phase 8 Workstream B — shared types + bounded product/engine
// sets for posture ingest. Auth lives in lib/with-cron-auth.ts
// (consolidated across all bearer-gated routes in WS-C §5.4).

export const BACKUP_PRODUCTS = new Set([
  "veeam", "datto", "restic", "windows-backup", "macos-tm", "none",
])
// AGT-AV-1 — the agent already DETECTS these cross-platform engines
// (ClamAV on Linux, XProtect on macOS, plus the EDR products) but the
// server discarded any engine not in this Set, leaving the AV column
// empty on Mac/Linux. Widen the allow-list so detected engines surface.
export const AV_ENGINES = new Set([
  "defender", "crowdstrike", "sophos", "sentinelone", "bitdefender",
  "clamav", "xprotect", "eset", "malwarebytes", "webroot", "none",
])

export interface DeviceLookup {
  id: string
  clientName: string
  hostname: string
}
