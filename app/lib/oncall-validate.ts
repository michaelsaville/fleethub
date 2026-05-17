import "server-only"
import { z } from "zod"
import { HHMM } from "@/lib/schemas"

// Phase 8 Workstream C §5.3 — composed-from-schemas validator.
// Same external API as the pre-zod hand-written schedule validator.

export interface NormalizedSlot {
  userId: string
  dayOfWeek: number
  start: string
  end: string
}
export interface NormalizedOverride {
  userId: string
  start: string
  end: string
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

const Slot = z.object({
  userId: z.string().min(1, "userId required"),
  dayOfWeek: z.number().int().min(0, "dayOfWeek must be 0-6 (Sun=0)").max(6, "dayOfWeek must be 0-6 (Sun=0)"),
  start: HHMM,
  end: HHMM,
})

// Overrides are ISO timestamps validated by parseability + end>start.
const Override = z
  .object({
    userId: z.string().min(1, "userId required"),
    start: z.string().refine((s) => Number.isFinite(Date.parse(s)), "start must be a parseable ISO date"),
    end: z.string().refine((s) => Number.isFinite(Date.parse(s)), "end must be a parseable ISO date"),
    reason: z
      .preprocess(
        (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null),
        z.string().nullable(),
      )
      .optional()
      .default(null),
  })
  .refine((o) => Date.parse(o.end) > Date.parse(o.start), "end must be AFTER start")

const SchedulePayload = z.object({
  name: z.string().trim().min(1, "name is required").max(80, "name must be 80 characters or fewer"),
  rotation: z.array(Slot).max(60, "max 60 rotation slots per schedule"),
  overrides: z.array(Override).max(60, "max 60 overrides per schedule").optional().default([]),
  isActive: z.coerce.boolean().optional().default(true),
})

export function validateSchedulePayload(body: Record<string, unknown>): ValidateResult {
  const parsed = SchedulePayload.safeParse(body)
  if (!parsed.success) return { ok: false, reason: firstReason(parsed.error) }
  return {
    ok: true,
    name: parsed.data.name,
    rotation: parsed.data.rotation,
    overrides: parsed.data.overrides,
    isActive: parsed.data.isActive,
  }
}

function firstReason(err: z.ZodError): string {
  const first = err.issues[0]
  if (!first) return "invalid payload"
  const path = first.path.length > 0 ? `${first.path.join(".")}: ` : ""
  return `${path}${first.message}`
}
