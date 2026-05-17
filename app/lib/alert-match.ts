import type { Fl_Alert } from "@prisma/client"

// Phase 8 Workstream C §5.5 — pure alert-match helpers. Lifted out
// of alert-dispatch.ts so vitest can import without dragging the
// whole prisma-loading dispatch surface. alert-dispatch.ts and
// runbook-evaluator.ts both re-import from here.

export interface MatchPredicate {
  /** "critical" | "warn" | "info" | string[] | "*" */
  severity?: string | string[]
  /** Glob like "disk.*" or exact "agent.disconnected". Case-insensitive. */
  kindLike?: string
}

// Loose channel shape — alert-dispatch.ts has the canonical version
// with its own [key:string]:unknown extension; this is the subset
// parseEscalationChain hands back. Callers cast as needed.
export interface ChannelConfig {
  type: "slack" | "teams" | "email" | "sms" | "pagerduty" | "ticket"
  webhookUrl?: string
  toEmails?: string[]
  ccEmails?: string[]
  phoneNumbers?: string[]
  integrationKey?: string
  oncallScheduleId?: string
  [key: string]: unknown
}

export interface EscalationStep {
  afterMin: number
  channels: ChannelConfig[]
}

/// Predicate match — alert routes + runbooks share semantics.
/// Severity `"*"` matches everything; an array does an inclusion
/// test. kindLike is a `*`-glob, case-insensitive, anchored.
export function matchesAlert(predicate: MatchPredicate, alert: Fl_Alert): boolean {
  if (predicate.severity !== undefined && predicate.severity !== "*") {
    const wanted = Array.isArray(predicate.severity)
      ? predicate.severity
      : [predicate.severity]
    if (!wanted.includes(alert.severity)) return false
  }
  if (predicate.kindLike !== undefined) {
    if (!globMatch(predicate.kindLike, alert.kind)) return false
  }
  return true
}

/// Parse an Fl_AlertRoute.escalationJson blob into a typed list.
/// Tolerant — malformed JSON, non-arrays, missing/invalid fields
/// silently drop the step rather than throwing (so a bad row
/// can't take down the dispatcher).
export function parseEscalationChain(json: string | null): EscalationStep[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    const out: EscalationStep[] = []
    for (const s of parsed) {
      if (!s || typeof s !== "object") continue
      const step = s as { afterMin?: unknown; channels?: unknown }
      const afterMin =
        typeof step.afterMin === "number" && step.afterMin > 0 ? step.afterMin : null
      if (afterMin == null) continue
      if (!Array.isArray(step.channels)) continue
      out.push({ afterMin, channels: step.channels as ChannelConfig[] })
    }
    return out
  } catch {
    return []
  }
}

function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    "i",
  )
  return re.test(value)
}
