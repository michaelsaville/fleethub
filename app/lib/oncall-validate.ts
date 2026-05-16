import "server-only"

// Phase 7 Workstream A step 8 — Fl_OncallSchedule payload validator.
// Shared by POST + PATCH so create + edit apply identical rules.

const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/

export interface NormalizedSlot {
  userId: string
  dayOfWeek: number
  start: string
  end: string
}
export interface NormalizedOverride {
  userId: string
  start: string  // ISO
  end: string    // ISO
  reason: string | null
}

export interface ValidSchedulePayload {
  ok: true
  name: string
  rotation: NormalizedSlot[]
  overrides: NormalizedOverride[]
  isActive: boolean
}

export type ValidateResult = ValidSchedulePayload | { ok: false; reason: string }

export function validateSchedulePayload(body: Record<string, unknown>): ValidateResult {
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return { ok: false, reason: "name is required" }
  if (name.length > 80) return { ok: false, reason: "name must be 80 characters or fewer" }

  if (!Array.isArray(body.rotation)) {
    return { ok: false, reason: "rotation must be an array of slot objects" }
  }
  if (body.rotation.length > 60) {
    return { ok: false, reason: "max 60 rotation slots per schedule" }
  }
  const rotation: NormalizedSlot[] = []
  for (let i = 0; i < body.rotation.length; i++) {
    const s = body.rotation[i] as Record<string, unknown> | null
    if (!s || typeof s !== "object") {
      return { ok: false, reason: `rotation slot ${i + 1}: not an object` }
    }
    const userId = typeof s.userId === "string" ? s.userId : ""
    if (!userId) return { ok: false, reason: `rotation slot ${i + 1}: userId required` }
    const dow = typeof s.dayOfWeek === "number" ? s.dayOfWeek : -1
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      return { ok: false, reason: `rotation slot ${i + 1}: dayOfWeek must be 0-6 (Sun=0)` }
    }
    const start = typeof s.start === "string" ? s.start : ""
    const end = typeof s.end === "string" ? s.end : ""
    if (!HHMM_RE.test(start)) {
      return { ok: false, reason: `rotation slot ${i + 1}: start must be "HH:MM" UTC` }
    }
    if (!HHMM_RE.test(end)) {
      return { ok: false, reason: `rotation slot ${i + 1}: end must be "HH:MM" UTC` }
    }
    rotation.push({ userId, dayOfWeek: dow, start, end })
  }

  const overrides: NormalizedOverride[] = []
  if (Array.isArray(body.overrides)) {
    if (body.overrides.length > 60) {
      return { ok: false, reason: "max 60 overrides per schedule" }
    }
    for (let i = 0; i < body.overrides.length; i++) {
      const o = body.overrides[i] as Record<string, unknown> | null
      if (!o || typeof o !== "object") {
        return { ok: false, reason: `override ${i + 1}: not an object` }
      }
      const userId = typeof o.userId === "string" ? o.userId : ""
      if (!userId) return { ok: false, reason: `override ${i + 1}: userId required` }
      const start = typeof o.start === "string" ? o.start : ""
      const end = typeof o.end === "string" ? o.end : ""
      const startMs = Date.parse(start)
      const endMs = Date.parse(end)
      if (!Number.isFinite(startMs)) {
        return { ok: false, reason: `override ${i + 1}: start must be a parseable ISO date` }
      }
      if (!Number.isFinite(endMs) || endMs <= startMs) {
        return { ok: false, reason: `override ${i + 1}: end must be a parseable ISO date AFTER start` }
      }
      const reason = typeof o.reason === "string" && o.reason.trim() ? o.reason.trim().slice(0, 200) : null
      overrides.push({ userId, start, end, reason })
    }
  }

  const isActive = body.isActive !== false

  return { ok: true, name, rotation, overrides, isActive }
}
