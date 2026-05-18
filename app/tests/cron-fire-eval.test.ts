import { describe, it, expect } from "vitest"
import { findDue, nextFireTime, decideBump, type CronCandidate } from "../lib/cron-fire-eval"

// Phase 12 WS-E.7 — cron-fire-eval pure-logic coverage. Six cron
// consumers (report-schedule + 5 new in Phase 12) share this helper,
// so the off-by-one and DST boundary cases are worth nailing down.

describe("findDue", () => {
  it("never-fired schedule whose prev is in the past → due", () => {
    // Cron: every hour at :00. now=10:30 → prev=10:00.
    const cands: CronCandidate[] = [
      { id: "x", cron: "0 * * * *", timezone: "UTC", lastFiredAt: null },
    ]
    const now = new Date("2026-05-18T10:30:00Z")
    const due = findDue(cands, now)
    expect(due.length).toBe(1)
    expect(due[0].fireTime.toISOString()).toBe("2026-05-18T10:00:00.000Z")
  })

  it("already-fired-for-this-fire-time is NOT due", () => {
    const cands: CronCandidate[] = [
      {
        id: "x",
        cron: "0 * * * *",
        timezone: "UTC",
        lastFiredAt: new Date("2026-05-18T10:00:00Z"),
      },
    ]
    const now = new Date("2026-05-18T10:30:00Z")
    const due = findDue(cands, now)
    expect(due.length).toBe(0)
  })

  it("next hour's tick re-makes it due", () => {
    const cands: CronCandidate[] = [
      {
        id: "x",
        cron: "0 * * * *",
        timezone: "UTC",
        lastFiredAt: new Date("2026-05-18T10:00:00Z"),
      },
    ]
    const now = new Date("2026-05-18T11:30:00Z")
    const due = findDue(cands, now)
    expect(due.length).toBe(1)
    expect(due[0].fireTime.toISOString()).toBe("2026-05-18T11:00:00.000Z")
  })

  it("invalid cron is skipped (not thrown)", () => {
    const cands: CronCandidate[] = [
      { id: "bad", cron: "not a cron string", timezone: "UTC", lastFiredAt: null },
      { id: "good", cron: "0 * * * *", timezone: "UTC", lastFiredAt: null },
    ]
    const errors: string[] = []
    const due = findDue(cands, new Date("2026-05-18T10:30:00Z"), (c) => {
      errors.push(c.id)
    })
    expect(errors).toEqual(["bad"])
    expect(due.map((d) => d.candidate.id)).toEqual(["good"])
  })

  it("tz-aware: NYC-defined window respects DST", () => {
    // "every day at 02:00" in America/New_York. On the day AFTER DST
    // spring-forward (2026-03-09), prev-from-now=2026-03-09T02:00 ET
    // = 06:00 UTC (EDT = UTC-4).
    const cands: CronCandidate[] = [
      { id: "x", cron: "0 2 * * *", timezone: "America/New_York", lastFiredAt: null },
    ]
    const now = new Date("2026-03-09T10:00:00Z") // post-spring-forward
    const due = findDue(cands, now)
    expect(due.length).toBe(1)
    // Should fire at 06:00 UTC (= 02:00 EDT)
    expect(due[0].fireTime.toISOString()).toBe("2026-03-09T06:00:00.000Z")
  })

  it("empty candidate list returns empty due array", () => {
    expect(findDue([], new Date())).toEqual([])
  })
})

describe("nextFireTime", () => {
  it("returns the next future tick", () => {
    const next = nextFireTime("0 * * * *", "UTC", new Date("2026-05-18T10:30:00Z"))
    expect(next?.toISOString()).toBe("2026-05-18T11:00:00.000Z")
  })

  it("returns null on parse failure (not throws)", () => {
    expect(nextFireTime("nope", "UTC", new Date())).toBeNull()
  })
})

describe("decideBump", () => {
  it("bumps lastFired even on fire-error (so the same fire-time doesn't retry next tick)", () => {
    const ft = new Date("2026-05-18T10:00:00Z")
    const r = decideBump(ft, { ok: false, error: "smtp timeout" })
    expect(r.shouldBump).toBe(true)
    expect(r.newLastFired).toEqual(ft)
    expect(r.error).toBe("smtp timeout")
  })

  it("bumps on success too", () => {
    const ft = new Date("2026-05-18T10:00:00Z")
    const r = decideBump(ft, { ok: true })
    expect(r.shouldBump).toBe(true)
    expect(r.newLastFired).toEqual(ft)
    expect(r.error).toBeUndefined()
  })
})
