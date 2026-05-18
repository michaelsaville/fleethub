import "server-only"
import { formatInTimeZone } from "date-fns-tz"
import { prisma } from "@/lib/prisma"

// Phase 7 Workstream A step 8 — on-call schedule resolver.
//
// Rotation slots cover a (dayOfWeek, start..end) window. Multiple
// slots may overlap; the earliest-listed slot in the rotation
// array wins. Overrides take precedence over the regular rotation
// and use absolute ISO timestamps rather than recurring weekly
// windows.
//
// Phase 12 WS-E.4 — DST-aware. Fl_OncallSchedule.timezone holds an
// IANA name ("America/New_York" etc). When set, rotation slot
// start/end are interpreted in that tz with DST correctly applied;
// when null, falls back to legacy UTC behavior. date-fns-tz handles
// the spring-forward gap + fall-back overlap correctly.

export interface RotationSlot {
  userId: string
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number
  /** "HH:MM" 24h, UTC. */
  start: string
  end: string
}

export interface OverrideWindow {
  userId: string
  /** ISO8601 inclusive start, UTC. */
  start: string
  /** ISO8601 exclusive end, UTC. */
  end: string
  reason?: string | null
}

export interface ResolvedOncall {
  user: {
    id: string
    name: string | null
    email: string
    phoneE164: string | null
  }
  /** True when an Override (not the rotation) matched. */
  fromOverride: boolean
}

/**
 * Resolve who's on-call for a schedule at a given instant. Returns
 * null when nobody is scheduled, the schedule is inactive, the
 * matched user is inactive, or the matched user can't be found.
 *
 * Public for use by alert-dispatch.ts and the schedule editor UI
 * (a live "who's on-call right now" preview).
 */
export async function resolveCurrentOncall(
  scheduleId: string,
  at: Date = new Date(),
): Promise<ResolvedOncall | null> {
  const sched = await prisma.fl_OncallSchedule.findUnique({
    where: { id: scheduleId },
    select: { isActive: true, rotationJson: true, overridesJson: true, timezone: true },
  })
  if (!sched || !sched.isActive) return null

  const overrides = parseOverrides(sched.overridesJson)
  const slots = parseRotation(sched.rotationJson)
  const atMs = at.getTime()
  // Phase 12 WS-E.4 — null tz preserves legacy UTC for already-
  // configured schedules.
  const tz = sched.timezone ?? "UTC"

  let userId: string | null = null
  let fromOverride = false

  // 1) Overrides first — chronological priority. ISO timestamps in
  // override windows are absolute; tz doesn't apply.
  for (const o of overrides) {
    const startMs = Date.parse(o.start)
    const endMs = Date.parse(o.end)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue
    if (atMs >= startMs && atMs < endMs) {
      userId = o.userId
      fromOverride = true
      break
    }
  }

  // 2) Rotation: first slot whose (dayOfWeek, HH:MM..HH:MM in tz)
  // covers `at`. formatInTimeZone handles DST transitions — at the
  // spring-forward gap the wall-clock skips, so a 02:30 slot
  // simply doesn't fire that Sunday (which is correct).
  if (!userId) {
    // "e" = ISO day of week (1=Mon..7=Sun); subtract for 0=Sun..6=Sat.
    const isoDow = Number(formatInTimeZone(at, tz, "e")) // 1..7 where 1=Mon
    const dow = isoDow === 7 ? 0 : isoDow // remap to Sunday=0
    const wallHHMM = formatInTimeZone(at, tz, "HH:mm")
    const hhmm = hhmmToMin(wallHHMM) ?? 0
    for (const s of slots) {
      if (s.dayOfWeek !== dow) continue
      const startMin = hhmmToMin(s.start)
      const endMin = hhmmToMin(s.end)
      if (startMin == null || endMin == null) continue
      const within =
        startMin <= endMin
          ? hhmm >= startMin && hhmm < endMin
          : // Slot wraps midnight (e.g. 20:00 → 04:00 same calendar day)
            hhmm >= startMin || hhmm < endMin
      if (within) {
        userId = s.userId
        break
      }
    }
  }

  if (!userId) return null

  const user = await prisma.fl_StaffUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, phoneE164: true, isActive: true },
  })
  if (!user || !user.isActive) return null
  return {
    user: { id: user.id, name: user.name, email: user.email, phoneE164: user.phoneE164 },
    fromOverride,
  }
}

function parseRotation(json: string): RotationSlot[] {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    const out: RotationSlot[] = []
    for (const s of parsed) {
      if (!s || typeof s !== "object") continue
      const x = s as Record<string, unknown>
      if (typeof x.userId !== "string") continue
      if (typeof x.dayOfWeek !== "number" || x.dayOfWeek < 0 || x.dayOfWeek > 6) continue
      if (typeof x.start !== "string" || typeof x.end !== "string") continue
      out.push({ userId: x.userId, dayOfWeek: x.dayOfWeek, start: x.start, end: x.end })
    }
    return out
  } catch {
    return []
  }
}

function parseOverrides(json: string | null): OverrideWindow[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    const out: OverrideWindow[] = []
    for (const s of parsed) {
      if (!s || typeof s !== "object") continue
      const x = s as Record<string, unknown>
      if (typeof x.userId !== "string") continue
      if (typeof x.start !== "string" || typeof x.end !== "string") continue
      out.push({
        userId: x.userId,
        start: x.start,
        end: x.end,
        reason: typeof x.reason === "string" ? x.reason : null,
      })
    }
    return out
  } catch {
    return []
  }
}

function hhmmToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}
