import "server-only"

// Phase 8 Workstream B step 5+6 — compliance score per client.
// Pure compute, no DB. Inputs are the per-client aggregates the
// caller has already gathered (msp-rollup / fleet-summary BFF).
//
// Formula from PHASE-8-DESIGN.md §4.3:
//
//   score = 100
//         - 10 * (hostsBehindPatch / deviceTotal)
//         - 15 * (hostsBackupStale / deviceTotal)
//         - 10 * (hostsAvDisabled  / deviceTotal)
//         -  5 * (hostsBitlockerOff / deviceTotal)   // HIPAA-mode only
//         - 20 * (auditChainBroken ? 1 : 0)
//
// Clamped to [0, 100]. When deviceTotal === 0 the score is 100
// (no devices = no risk surface; the upstream UI hides the chip
// when the client has zero devices).

export interface PostureScoreInputs {
  deviceTotal: number
  hostsBehindPatch: number
  hostsBackupStale: number
  hostsAvDisabled: number
  hostsBitlockerOff: number
  hipaaMode: boolean
  auditChainBroken: boolean
}

export interface PostureScoreBreakdown {
  score: number
  /// Sum of all penalties applied. Useful for the operator-side
  /// breakdown column on /msp; the customer-portal card hides this.
  penaltyTotal: number
  /// Per-rule penalty contributions (each ≥ 0).
  penalties: {
    patch: number
    backup: number
    av: number
    bitlocker: number
    audit: number
  }
}

export function computePostureScore(i: PostureScoreInputs): PostureScoreBreakdown {
  if (i.deviceTotal === 0) {
    return {
      score: 100,
      penaltyTotal: 0,
      penalties: { patch: 0, backup: 0, av: 0, bitlocker: 0, audit: 0 },
    }
  }
  const ratio = (n: number) => Math.max(0, Math.min(1, n / i.deviceTotal))
  const patchPenalty    = 10 * ratio(i.hostsBehindPatch)
  const backupPenalty   = 15 * ratio(i.hostsBackupStale)
  const avPenalty       = 10 * ratio(i.hostsAvDisabled)
  const bitlockerPenalty = i.hipaaMode ? 5 * ratio(i.hostsBitlockerOff) : 0
  const auditPenalty    = i.auditChainBroken ? 20 : 0
  const penaltyTotal = patchPenalty + backupPenalty + avPenalty + bitlockerPenalty + auditPenalty
  const score = Math.max(0, Math.min(100, Math.round(100 - penaltyTotal)))
  return {
    score,
    penaltyTotal,
    penalties: {
      patch:    Math.round(patchPenalty),
      backup:   Math.round(backupPenalty),
      av:       Math.round(avPenalty),
      bitlocker: Math.round(bitlockerPenalty),
      audit:    Math.round(auditPenalty),
    },
  }
}

/// Threshold helpers used by callers — backup is "stale" at >72h
/// since last success; av is "disabled" when the agent has
/// affirmatively reported avEnabled=false (null = not reported,
/// not counted). Centralized so /msp and /fleet stay in sync.
export const BACKUP_STALE_MS = 72 * 60 * 60 * 1000

export function isBackupStale(
  lastSuccess: Date | null,
  product: string | null,
  now: number,
): boolean {
  if (!product || product === "none") return false
  if (!lastSuccess) return true
  return now - lastSuccess.getTime() > BACKUP_STALE_MS
}

export function isAvDisabled(
  enabled: boolean | null,
  engine: string | null,
): boolean {
  if (!engine || engine === "none") return true
  return enabled === false
}

export function isBitlockerOff(on: boolean | null): boolean {
  return on === false
}

/// Tone band for chip rendering. Same cutoffs across MSP + portal.
export function toneForScore(score: number): "ok" | "warn" | "bad" {
  if (score >= 90) return "ok"
  if (score >= 70) return "warn"
  return "bad"
}
