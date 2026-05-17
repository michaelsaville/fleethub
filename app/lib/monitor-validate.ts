import "server-only"
import { z } from "zod"
import { SUPPORTED_METRICS } from "@/lib/monitor-evaluator"
import { SeverityEnum } from "@/lib/schemas"

// Phase 8 Workstream C §5.3 — composed-from-schemas validator.
// Same external API as the hand-written monitor validator.

const EMIT_KIND_RE = /^[a-z0-9._-]+$/

const Predicate = z.object({
  operator: z.enum(["lt", "gt", "eq", "neq"]),
  value: z
    .number()
    .refine((n) => Number.isFinite(n), "predicate.value must be a finite number"),
  osFilter: z
    .preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(["windows", "linux", "darwin"]).optional()),
  deviceTag: z
    .preprocess((v) => {
      if (typeof v !== "string") return undefined
      const t = v.trim()
      return t || undefined
    }, z.string().optional()),
  forMin: z
    .number()
    .int()
    .min(1, "predicate.forMin must be between 1 and 1440")
    .max(1440, "predicate.forMin must be between 1 and 1440")
    .optional(),
})

const MetricEnum = z.string().refine(
  (s) => (SUPPORTED_METRICS as readonly string[]).includes(s),
  { message: `metric must be one of: ${SUPPORTED_METRICS.join(", ")}` },
)

const PayloadSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120, "name must be 120 characters or fewer"),
  tenantName: z
    .preprocess((v) => {
      if (v === undefined || v === null || v === "") return null
      if (typeof v === "string") return v.trim() || null
      throw new Error("tenantName must be a string or null")
    }, z.string().nullable())
    .optional()
    .default(null),
  metric: MetricEnum,
  predicate: Predicate,
  severity: SeverityEnum,
  emitKind: z
    .preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string())
    .optional()
    .default(""),
  cooldownMin: z.coerce.number().int().min(0).max(1440).optional().default(30),
  isActive: z.coerce.boolean().optional().default(true),
})

export interface MonitorPayload {
  name: string
  tenantName: string | null
  metric: string
  predicate: {
    operator: "lt" | "gt" | "eq" | "neq"
    value: number
    osFilter?: "windows" | "linux" | "darwin"
    deviceTag?: string
    forMin?: number
  }
  severity: "critical" | "warn" | "info"
  emitKind: string
  cooldownMin: number
  isActive: boolean
}

export type ValidateResult =
  | ({ ok: true } & MonitorPayload)
  | { ok: false; reason: string }

export function validateMonitorPayload(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "Body must be a JSON object" }
  }
  let parsed: z.infer<typeof PayloadSchema>
  try {
    parsed = PayloadSchema.parse(raw)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, reason: firstReason(err) }
    }
    return { ok: false, reason: err instanceof Error ? err.message : "invalid payload" }
  }

  // Derive emitKind default from name when caller didn't supply one.
  let emitKind = parsed.emitKind
  if (!emitKind) {
    emitKind = `monitor.${
      parsed.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "untitled"
    }`
  }
  if (!EMIT_KIND_RE.test(emitKind)) {
    return {
      ok: false,
      reason: "emitKind must be lowercase letters, digits, dots, underscores, or dashes",
    }
  }
  if (emitKind.length > 100) {
    return { ok: false, reason: "emitKind must be 100 characters or fewer" }
  }

  return {
    ok: true,
    name: parsed.name,
    tenantName: parsed.tenantName,
    metric: parsed.metric,
    predicate: parsed.predicate,
    severity: parsed.severity,
    emitKind,
    cooldownMin: parsed.cooldownMin,
    isActive: parsed.isActive,
  }
}

function firstReason(err: z.ZodError): string {
  const first = err.issues[0]
  if (!first) return "invalid payload"
  const path = first.path.length > 0 ? `${first.path.join(".")}: ` : ""
  return `${path}${first.message}`
}
