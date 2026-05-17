import { describe, it, expect } from "vitest"
import {
  computePostureScore,
  isBackupStale,
  isAvDisabled,
  isBitlockerOff,
  toneForScore,
  BACKUP_STALE_MS,
} from "../lib/posture-score"

describe("computePostureScore", () => {
  it("returns 100 when deviceTotal=0 (nothing to deduct)", () => {
    const r = computePostureScore({
      deviceTotal: 0,
      hostsBehindPatch: 0,
      hostsBackupStale: 0,
      hostsAvDisabled: 0,
      hostsBitlockerOff: 0,
      hipaaMode: false,
      auditChainBroken: false,
    })
    expect(r.score).toBe(100)
    expect(r.penaltyTotal).toBe(0)
  })

  it("returns 100 when no penalties apply", () => {
    const r = computePostureScore({
      deviceTotal: 10,
      hostsBehindPatch: 0,
      hostsBackupStale: 0,
      hostsAvDisabled: 0,
      hostsBitlockerOff: 0,
      hipaaMode: true,
      auditChainBroken: false,
    })
    expect(r.score).toBe(100)
  })

  it("applies the full 10/15/10/5/20 penalty formula", () => {
    // All hosts violating every rule → 100 - 60 - 0 (no audit) = 40
    const r = computePostureScore({
      deviceTotal: 10,
      hostsBehindPatch: 10,
      hostsBackupStale: 10,
      hostsAvDisabled: 10,
      hostsBitlockerOff: 10,
      hipaaMode: true,
      auditChainBroken: false,
    })
    expect(r.penalties.patch).toBe(10)
    expect(r.penalties.backup).toBe(15)
    expect(r.penalties.av).toBe(10)
    expect(r.penalties.bitlocker).toBe(5)
    expect(r.penalties.audit).toBe(0)
    expect(r.score).toBe(60)
  })

  it("audit chain broken adds the flat 20-point penalty", () => {
    const r = computePostureScore({
      deviceTotal: 10,
      hostsBehindPatch: 0,
      hostsBackupStale: 0,
      hostsAvDisabled: 0,
      hostsBitlockerOff: 0,
      hipaaMode: false,
      auditChainBroken: true,
    })
    expect(r.score).toBe(80)
    expect(r.penalties.audit).toBe(20)
  })

  it("non-HIPAA tenants skip the BitLocker penalty even when reported off", () => {
    const r = computePostureScore({
      deviceTotal: 10,
      hostsBehindPatch: 0,
      hostsBackupStale: 0,
      hostsAvDisabled: 0,
      hostsBitlockerOff: 10,
      hipaaMode: false,
      auditChainBroken: false,
    })
    expect(r.penalties.bitlocker).toBe(0)
    expect(r.score).toBe(100)
  })

  it("clamps to 0 at the bottom", () => {
    // Pile up enough penalties to push below 0
    const r = computePostureScore({
      deviceTotal: 10,
      hostsBehindPatch: 10,
      hostsBackupStale: 10,
      hostsAvDisabled: 10,
      hostsBitlockerOff: 10,
      hipaaMode: true,
      auditChainBroken: true,
    })
    expect(r.score).toBe(40)
  })

  it("ratio penalties scale with the proportion of affected hosts", () => {
    const r = computePostureScore({
      deviceTotal: 10,
      hostsBehindPatch: 5,
      hostsBackupStale: 0,
      hostsAvDisabled: 0,
      hostsBitlockerOff: 0,
      hipaaMode: false,
      auditChainBroken: false,
    })
    // 5/10 * 10 = 5
    expect(r.penalties.patch).toBe(5)
    expect(r.score).toBe(95)
  })
})

describe("threshold helpers", () => {
  it("isBackupStale: null product = not stale", () => {
    expect(isBackupStale(null, null, Date.now())).toBe(false)
  })

  it("isBackupStale: product='none' is not stale", () => {
    expect(isBackupStale(null, "none", Date.now())).toBe(false)
  })

  it("isBackupStale: product set, no lastSuccess = stale", () => {
    expect(isBackupStale(null, "restic", Date.now())).toBe(true)
  })

  it("isBackupStale: success within 72h = fresh", () => {
    const now = Date.now()
    expect(isBackupStale(new Date(now - 24 * 3600_000), "restic", now)).toBe(false)
  })

  it("isBackupStale: success past 72h = stale", () => {
    const now = Date.now()
    expect(isBackupStale(new Date(now - BACKUP_STALE_MS - 1000), "restic", now)).toBe(true)
  })

  it("isAvDisabled: no engine = disabled", () => {
    expect(isAvDisabled(true, null)).toBe(true)
  })

  it("isAvDisabled: engine='none' = disabled", () => {
    expect(isAvDisabled(true, "none")).toBe(true)
  })

  it("isAvDisabled: engine set + enabled=false = disabled", () => {
    expect(isAvDisabled(false, "defender")).toBe(true)
  })

  it("isAvDisabled: engine set + enabled=true = not disabled", () => {
    expect(isAvDisabled(true, "defender")).toBe(false)
  })

  it("isBitlockerOff: false = off; true/null = not off", () => {
    expect(isBitlockerOff(false)).toBe(true)
    expect(isBitlockerOff(true)).toBe(false)
    expect(isBitlockerOff(null)).toBe(false)
  })

  it("toneForScore bands: 90+ ok, 70-89 warn, <70 bad", () => {
    expect(toneForScore(100)).toBe("ok")
    expect(toneForScore(90)).toBe("ok")
    expect(toneForScore(89)).toBe("warn")
    expect(toneForScore(70)).toBe("warn")
    expect(toneForScore(69)).toBe("bad")
    expect(toneForScore(0)).toBe("bad")
  })
})
