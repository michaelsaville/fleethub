import "server-only"

// Phase 8 Workstream B — shared types + bounded product/engine
// sets for posture ingest. Auth lives in lib/with-cron-auth.ts
// (consolidated across all bearer-gated routes in WS-C §5.4).

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
