import "server-only"
import { isValidWebhookUrl } from "@/lib/webhook-delivery"

// Phase 7 Workstream A step 3 — input validator for Fl_AlertRoute.
// Shared by POST + PATCH so the create and edit paths apply
// exactly the same rules.

type SeverityToken = "critical" | "warn" | "info"
const SEVERITY_VALUES: readonly SeverityToken[] = ["critical", "warn", "info"]

interface NormalizedMatch {
  severity?: SeverityToken[]
  kindLike?: string
}

export interface NormalizedChannel {
  type: "slack" | "teams" | "email"
  webhookUrl?: string
  toEmails?: string[]
  ccEmails?: string[]
}

export interface ValidRoutePayload {
  ok: true
  tenantName: string | null
  match: NormalizedMatch
  channels: NormalizedChannel[]
  dedupWindowMin: number
  priority: number
  isActive: boolean
}

export type ValidateResult =
  | ValidRoutePayload
  | { ok: false; reason: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateRoutePayload(body: Record<string, unknown>): ValidateResult {
  // tenantName — empty string from the form means "all tenants" (null).
  const tenantName =
    typeof body.tenantName === "string" && body.tenantName.trim()
      ? body.tenantName.trim()
      : null

  // match
  const matchIn = (body.match ?? {}) as Record<string, unknown>
  const severityIn = matchIn.severity
  const severity: SeverityToken[] = []
  if (Array.isArray(severityIn)) {
    for (const s of severityIn) {
      if (typeof s === "string" && (SEVERITY_VALUES as readonly string[]).includes(s)) {
        severity.push(s as SeverityToken)
      }
    }
  } else if (typeof severityIn === "string" && (SEVERITY_VALUES as readonly string[]).includes(severityIn)) {
    severity.push(severityIn as SeverityToken)
  }
  const kindLikeRaw = typeof matchIn.kindLike === "string" ? matchIn.kindLike.trim() : ""
  if (kindLikeRaw.length > 200) {
    return { ok: false, reason: "match.kindLike must be 200 characters or fewer" }
  }
  const match: NormalizedMatch = {}
  if (severity.length > 0) match.severity = severity
  if (kindLikeRaw) match.kindLike = kindLikeRaw

  // channels — at least one required.
  if (!Array.isArray(body.channels) || body.channels.length === 0) {
    return { ok: false, reason: "at least one channel is required" }
  }
  if (body.channels.length > 10) {
    return { ok: false, reason: "max 10 channels per route" }
  }
  const channels: NormalizedChannel[] = []
  for (let i = 0; i < body.channels.length; i++) {
    const c = body.channels[i] as Record<string, unknown> | null
    if (!c || typeof c !== "object") {
      return { ok: false, reason: `channel ${i + 1}: not an object` }
    }
    const type = c.type
    if (type === "slack" || type === "teams") {
      const url = typeof c.webhookUrl === "string" ? c.webhookUrl.trim() : ""
      if (!url) return { ok: false, reason: `${type} channel: webhookUrl required` }
      if (!isValidWebhookUrl(url, type)) {
        return { ok: false, reason: `${type} channel: webhookUrl does not look like a ${type} incoming webhook` }
      }
      channels.push({ type, webhookUrl: url })
      continue
    }
    if (type === "email") {
      const toIn = Array.isArray(c.toEmails) ? c.toEmails : []
      const to: string[] = []
      for (const x of toIn) {
        if (typeof x === "string" && EMAIL_RE.test(x.trim())) to.push(x.trim())
      }
      if (to.length === 0) {
        return { ok: false, reason: "email channel: at least one valid toEmail required" }
      }
      const ccIn = Array.isArray(c.ccEmails) ? c.ccEmails : []
      const cc: string[] = []
      for (const x of ccIn) {
        if (typeof x === "string" && EMAIL_RE.test(x.trim())) cc.push(x.trim())
      }
      const channel: NormalizedChannel = { type: "email", toEmails: to }
      if (cc.length > 0) channel.ccEmails = cc
      channels.push(channel)
      continue
    }
    return { ok: false, reason: `channel ${i + 1}: type "${String(type)}" not supported (slack | teams | email)` }
  }

  // numbers
  const dedupWindowMin = clampInt(body.dedupWindowMin, 0, 1440, 15)
  const priority = clampInt(body.priority, 0, 1000, 100)
  const isActive = body.isActive !== false

  return {
    ok: true,
    tenantName,
    match,
    channels,
    dedupWindowMin,
    priority,
    isActive,
  }
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, Math.floor(n)))
}
