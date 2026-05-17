import "server-only"
import { z } from "zod"
import { normalizeMatch, type Severity } from "@/lib/schemas"

// Phase 8 Workstream C §5.3 — composed-from-schemas validator.
// Same external API as the pre-zod hand-written runbook validator.

export interface NormalizedMatch {
  severity?: Severity[]
  kindLike?: string
}

export interface ValidRunbookPayload {
  ok: true
  name: string
  description: string | null
  match: NormalizedMatch
  scriptId: string
  graceMin: number
  cooldownMin: number
  dryRunFirst: boolean
  dryRunPredicateJson: string | null
  maxFiresPerHour: number
  maxConsecutiveFailures: number
  isActive: boolean
}

export type ValidateResult =
  | ValidRunbookPayload
  | { ok: false; reason: string }

// dryRunPredicate may arrive as either a string (already-stringified
// JSON) or as a parsed object. The schema normalizes to a stored
// string or null; we still validate that the string parses.
const DryRunPredicate = z.preprocess((v) => {
  if (v === undefined || v === null) return null
  if (typeof v === "string") {
    const t = v.trim()
    if (!t) return null
    try {
      JSON.parse(t)
    } catch {
      throw new Error("dryRunPredicate must be valid JSON (leave blank to omit)")
    }
    if (t.length > 2000) throw new Error("dryRunPredicate must be 2000 characters or fewer")
    return t
  }
  if (typeof v === "object") return JSON.stringify(v)
  return null
}, z.string().nullable())

const RunbookPayload = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name is required")
    .max(80, "name must be 80 characters or fewer"),
  description: z
    .preprocess((v) => {
      if (typeof v !== "string") return null
      const t = v.trim()
      return t ? t.slice(0, 500) : null
    }, z.string().nullable())
    .optional()
    .default(null),
  scriptId: z.string().trim().min(1, "scriptId is required"),
  match: z.any().optional(),
  graceMin: z.coerce.number().int().min(0).max(1440).optional().default(2),
  cooldownMin: z.coerce.number().int().min(0).max(1440).optional().default(30),
  maxFiresPerHour: z.coerce.number().int().min(1).max(1000).optional().default(10),
  maxConsecutiveFailures: z.coerce.number().int().min(1).max(100).optional().default(3),
  dryRunFirst: z.coerce.boolean().optional().default(true),
  dryRunPredicate: DryRunPredicate.optional().default(null),
  isActive: z.coerce.boolean().optional().default(true),
})

export function validateRunbookPayload(body: Record<string, unknown>): ValidateResult {
  let parsed: z.infer<typeof RunbookPayload>
  try {
    parsed = RunbookPayload.parse(body)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, reason: firstReason(err) }
    }
    return { ok: false, reason: err instanceof Error ? err.message : "invalid payload" }
  }

  const match = normalizeMatch(parsed.match)
  if (!match.severity && !match.kindLike) {
    return {
      ok: false,
      reason:
        "match must include at least a severity or a kindLike — an unbounded runbook would fire on every alert",
    }
  }

  return {
    ok: true,
    name: parsed.name,
    description: parsed.description,
    match,
    scriptId: parsed.scriptId,
    graceMin: parsed.graceMin,
    cooldownMin: parsed.cooldownMin,
    dryRunFirst: parsed.dryRunFirst,
    dryRunPredicateJson: parsed.dryRunPredicate,
    maxFiresPerHour: parsed.maxFiresPerHour,
    maxConsecutiveFailures: parsed.maxConsecutiveFailures,
    isActive: parsed.isActive,
  }
}

function firstReason(err: z.ZodError): string {
  const first = err.issues[0]
  if (!first) return "invalid payload"
  const path = first.path.length > 0 ? `${first.path.join(".")}: ` : ""
  return `${path}${first.message}`
}
