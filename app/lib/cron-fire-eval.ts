import "server-only"
import { CronExpressionParser } from "cron-parser"

// Phase 12 WS-E.2 — generic cron-due evaluator.
//
// Six cron consumers (report-schedule, maintenance-window-eval,
// network-probe, network-probe-rollup, network-probe-retain,
// approval-expiry-sweep) all need the same shape:
//   1. Parse a cron string, optionally tz-aware
//   2. Compute the most recent should-fire time
//   3. Compare against lastFiredAt
//   4. Fire if prev > lastFiredAt AND prev <= now
//   5. Bump lastFiredAt to `prev` (NOT `now`) so idempotency holds
//      across slow ticks
//
// Hand-rolling this six times = at least one subtle off-by-one
// (DST, `<=` vs `<`, missing tz) silently double-fires or misses
// windows. Extract once, migrate report-schedule.ts in the same
// PR as proof.

export interface CronCandidate {
  /** Stable id used for log messages. */
  id: string
  cron: string
  timezone?: string | null
  lastFiredAt: Date | null
}

export interface DueRow<T extends CronCandidate> {
  candidate: T
  /** The should-fire instant (in UTC). bumpLastFired writes this. */
  fireTime: Date
}

/** Pure, no-DB. Filters candidates to those whose most recent
 *  scheduled fire-time has passed AND is later than lastFiredAt. */
export function findDue<T extends CronCandidate>(
  candidates: T[],
  now: Date = new Date(),
  onParseError?: (c: T, err: unknown) => void,
): DueRow<T>[] {
  const due: DueRow<T>[] = []
  for (const c of candidates) {
    let prev: Date
    try {
      const it = CronExpressionParser.parse(c.cron, {
        tz: c.timezone || "UTC",
        currentDate: now,
      })
      prev = it.prev().toDate()
    } catch (err) {
      if (onParseError) onParseError(c, err)
      else {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(
          `[cron-fire-eval] invalid cron "${c.cron}" on ${c.id}: ${msg}`,
        )
      }
      continue
    }
    const lastFired = c.lastFiredAt ?? new Date(0)
    if (prev > lastFired && prev <= now) {
      due.push({ candidate: c, fireTime: prev })
    }
  }
  return due
}

/** Compute the NEXT fire time after `now`. Used by the UI to show
 *  "next fires at …". */
export function nextFireTime(
  cron: string,
  timezone: string | null = "UTC",
  now: Date = new Date(),
): Date | null {
  try {
    const it = CronExpressionParser.parse(cron, {
      tz: timezone || "UTC",
      currentDate: now,
    })
    return it.next().toDate()
  } catch {
    return null
  }
}

/** Helper that returns `{ shouldBump: true, newLastFired: fireTime }`
 *  on success or a no-op shape on error. Caller writes the actual
 *  DB update — keeps this module DB-free for testability. The
 *  convention everywhere: bump even on FIRE-ERROR so the same
 *  fire-time doesn't get retried on the next tick. Errors get
 *  retried at the NEXT cron interval. */
export function decideBump(
  fireTime: Date,
  fireResult: { ok: boolean; error?: string },
): { shouldBump: boolean; newLastFired: Date; error?: string } {
  return {
    shouldBump: true,
    newLastFired: fireTime,
    error: fireResult.ok ? undefined : fireResult.error,
  }
}
