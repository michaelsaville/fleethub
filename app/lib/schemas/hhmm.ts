import { z } from "zod"

// Phase 8 Workstream C §5.3 — HH:MM atom. UTC time-of-day used by
// Fl_OncallSchedule rotation slots. Accepts 0-23 hours, leading
// zero optional on hours, 0-59 minutes.

const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/

export const HHMM = z
  .string()
  .refine((s) => HHMM_RE.test(s), 'must be "HH:MM" UTC (e.g. "08:00")')

export type HHMM = z.infer<typeof HHMM>
