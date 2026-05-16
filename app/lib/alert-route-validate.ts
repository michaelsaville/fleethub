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
  type: "slack" | "teams" | "email" | "sms"
  webhookUrl?: string
  toEmails?: string[]
  ccEmails?: string[]
  /** E.164 phone numbers for sms channels. */
  phoneNumbers?: string[]
}

export interface NormalizedEscalationStep {
  afterMin: number
  channels: NormalizedChannel[]
}

export interface ValidRoutePayload {
  ok: true
  tenantName: string | null
  match: NormalizedMatch
  channels: NormalizedChannel[]
  /** Empty array when no escalation chain is configured. */
  escalation: NormalizedEscalationStep[]
  dedupWindowMin: number
  priority: number
  isActive: boolean
}

export type ValidateResult =
  | ValidRoutePayload
  | { ok: false; reason: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const E164_RE = /^\+[1-9]\d{6,14}$/

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
  const primary = validateChannelList(body.channels, "primary")
  if ("error" in primary) return { ok: false, reason: primary.error }
  const channels = primary.channels

  // escalation chain — optional
  const escalation: NormalizedEscalationStep[] = []
  if (Array.isArray(body.escalation)) {
    if (body.escalation.length > 10) {
      return { ok: false, reason: "max 10 escalation steps" }
    }
    for (let i = 0; i < body.escalation.length; i++) {
      const s = body.escalation[i] as Record<string, unknown> | null
      if (!s || typeof s !== "object") {
        return { ok: false, reason: `escalation step ${i + 1}: not an object` }
      }
      const afterMin = clampInt(s.afterMin, 1, 1440, 0)
      if (afterMin <= 0) {
        return { ok: false, reason: `escalation step ${i + 1}: afterMin must be 1-1440` }
      }
      const stepChannels = validateChannelList(s.channels, `escalation step ${i + 1}`)
      if ("error" in stepChannels) return { ok: false, reason: stepChannels.error }
      escalation.push({ afterMin, channels: stepChannels.channels })
    }
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
    escalation,
    dedupWindowMin,
    priority,
    isActive,
  }
}

function validateChannelList(
  raw: unknown,
  label: string,
): { channels: NormalizedChannel[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: `${label}: at least one channel is required` }
  }
  if (raw.length > 10) {
    return { error: `${label}: max 10 channels` }
  }
  const out: NormalizedChannel[] = []
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown> | null
    if (!c || typeof c !== "object") {
      return { error: `${label} channel ${i + 1}: not an object` }
    }
    const type = c.type
    if (type === "slack" || type === "teams") {
      const url = typeof c.webhookUrl === "string" ? c.webhookUrl.trim() : ""
      if (!url) return { error: `${label} ${type} channel: webhookUrl required` }
      if (!isValidWebhookUrl(url, type)) {
        return { error: `${label} ${type} channel: webhookUrl does not look like a ${type} incoming webhook` }
      }
      out.push({ type, webhookUrl: url })
      continue
    }
    if (type === "email") {
      const toIn = Array.isArray(c.toEmails) ? c.toEmails : []
      const to: string[] = []
      for (const x of toIn) {
        if (typeof x === "string" && EMAIL_RE.test(x.trim())) to.push(x.trim())
      }
      if (to.length === 0) {
        return { error: `${label} email channel: at least one valid toEmail required` }
      }
      const ccIn = Array.isArray(c.ccEmails) ? c.ccEmails : []
      const cc: string[] = []
      for (const x of ccIn) {
        if (typeof x === "string" && EMAIL_RE.test(x.trim())) cc.push(x.trim())
      }
      const channel: NormalizedChannel = { type: "email", toEmails: to }
      if (cc.length > 0) channel.ccEmails = cc
      out.push(channel)
      continue
    }
    if (type === "sms") {
      const numbersIn = Array.isArray(c.phoneNumbers) ? c.phoneNumbers : []
      const phoneNumbers: string[] = []
      for (const x of numbersIn) {
        if (typeof x !== "string") continue
        const trimmed = x.trim()
        if (!E164_RE.test(trimmed)) {
          return { error: `${label} sms channel: "${trimmed}" is not E.164 format (e.g. +14155551234)` }
        }
        phoneNumbers.push(trimmed)
      }
      if (phoneNumbers.length === 0) {
        return { error: `${label} sms channel: at least one E.164 phone number required` }
      }
      if (phoneNumbers.length > 20) {
        return { error: `${label} sms channel: max 20 phone numbers per channel` }
      }
      out.push({ type: "sms", phoneNumbers })
      continue
    }
    return { error: `${label} channel ${i + 1}: type "${String(type)}" not supported (slack | teams | email | sms)` }
  }
  return { channels: out }
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, Math.floor(n)))
}
