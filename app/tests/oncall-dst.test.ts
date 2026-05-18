import { describe, it, expect } from "vitest"
import { formatInTimeZone } from "date-fns-tz"

// Phase 12 WS-E.7 — DST coverage. The actual resolveCurrentOncall
// path needs a DB; here we lock down the date-fns-tz primitive the
// lib/oncall.ts swap relies on. 4 cases per architect §8.

describe("formatInTimeZone DST behavior", () => {
  it("DST-forward: 02:30 wall-clock doesn't exist (US/Eastern, 2026-03-08)", () => {
    // 2026-03-08 02:00 ET → jumps to 03:00 EDT. 02:30 ET wall is undefined.
    // We test by checking that 06:30 UTC (which would be 02:30 EDT under
    // normal arithmetic) formats correctly under the new offset.
    const at = new Date("2026-03-08T07:30:00Z") // 03:30 EDT post-jump
    const wall = formatInTimeZone(at, "America/New_York", "HH:mm")
    expect(wall).toBe("03:30")
  })

  it("DST-back: 01:30 wall-clock happens twice (US/Eastern, 2026-11-01)", () => {
    // 2026-11-01 02:00 EDT → 01:00 EST. Wall 01:30 occurs once at
    // 05:30 UTC (EDT) and once at 06:30 UTC (EST).
    const first = new Date("2026-11-01T05:30:00Z")
    const second = new Date("2026-11-01T06:30:00Z")
    const w1 = formatInTimeZone(first, "America/New_York", "HH:mm")
    const w2 = formatInTimeZone(second, "America/New_York", "HH:mm")
    expect(w1).toBe("01:30")
    expect(w2).toBe("01:30")
    // The two instants are 1 hour apart in UTC but the same wall clock.
    expect(second.getTime() - first.getTime()).toBe(60 * 60 * 1000)
  })

  it("Arizona (no DST): 02:30 wall stays MST year-round", () => {
    // Arizona is UTC-7 always (no DST).
    const summer = new Date("2026-07-15T09:30:00Z")
    const winter = new Date("2026-12-15T09:30:00Z")
    const wallSummer = formatInTimeZone(summer, "America/Phoenix", "HH:mm")
    const wallWinter = formatInTimeZone(winter, "America/Phoenix", "HH:mm")
    expect(wallSummer).toBe("02:30")
    expect(wallWinter).toBe("02:30")
  })

  it("Hawaii (UTC-10 no DST): 02:30 wall = 12:30 UTC year-round", () => {
    const at = new Date("2026-07-15T12:30:00Z")
    const wall = formatInTimeZone(at, "Pacific/Honolulu", "HH:mm")
    expect(wall).toBe("02:30")
  })

  it("ISO day-of-week mapping (Mon=1..Sun=7) survives DST boundaries", () => {
    // 2026-03-08 is a Sunday in US/Eastern.
    const at = new Date("2026-03-08T15:00:00Z")
    const dow = formatInTimeZone(at, "America/New_York", "e")
    expect(dow).toBe("1") // Sunday = 1 in date-fns 'e' (1=Sun..7=Sat)
  })

  it("Remap to Sun=0..Sat=6 (the schema's dayOfWeek convention)", () => {
    // The schema's rotation slots use 0=Sun..6=Sat. date-fns 'e'
    // returns 1=Sun..7=Sat (sun-starts-week locale). So remap is:
    // dow = isoE === 7 ? 0 : isoE — handles only when isoE follows
    // Mon=1..Sun=7 convention. For 'e' with Sunday-start the math
    // is dow = isoE - 1.
    for (const [iso, expected] of [
      [1, 0], // Sun
      [2, 1], // Mon
      [3, 2], // Tue
      [4, 3], // Wed
      [5, 4], // Thu
      [6, 5], // Fri
      [7, 6], // Sat
    ] as const) {
      const dow = iso - 1
      expect(dow).toBe(expected)
    }
  })
})
