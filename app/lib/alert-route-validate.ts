import "server-only"
import { z } from "zod"
import { ChannelList, normalizeMatch, type ChannelConfig } from "@/lib/schemas"
import type { Severity } from "@/lib/schemas"

// Phase 8 Workstream C §5.3 — composed-from-schemas validator.
// Same external API (validateRoutePayload + ValidRoutePayload +
// ValidateResult) so the 2 admin routes that call this stay
// unchanged. Atoms + match + channel union live under lib/schemas/.

// ─── Backward-compat exports ─────────────────────────────────────
// These types matched the pre-zod hand-written shapes. Re-exported
// so any consumer outside the lib/ folder that imports them keeps
// compiling. The new canonical types are zod-inferred under
// lib/schemas/.

export interface NormalizedChannel {
  type: ChannelConfig["type"]
  webhookUrl?: string
  toEmails?: string[]
  ccEmails?: string[]
  phoneNumbers?: string[]
  integrationKey?: string
  oncallScheduleId?: string
}
export interface NormalizedEscalationStep {
  afterMin: number
  channels: NormalizedChannel[]
}

export interface ValidRoutePayload {
  ok: true
  tenantName: string | null
  match: { severity?: Severity[]; kindLike?: string }
  channels: NormalizedChannel[]
  escalation: NormalizedEscalationStep[]
  dedupWindowMin: number
  priority: number
  isActive: boolean
}

export type ValidateResult =
  | ValidRoutePayload
  | { ok: false; reason: string }

const EscalationStep = z.object({
  afterMin: z.coerce
    .number()
    .int()
    .min(1, "afterMin must be 1-1440")
    .max(1440, "afterMin must be 1-1440"),
  channels: ChannelList,
})

const RoutePayload = z.object({
  // Empty string from the form means "all tenants" → null after normalize.
  tenantName: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : null),
    z.string().nullable(),
  ),
  match: z.any().optional(),
  channels: ChannelList,
  escalation: z.array(EscalationStep).max(10, "max 10 escalation steps").optional().default([]),
  dedupWindowMin: z.coerce.number().int().min(0).max(1440).optional().default(15),
  priority: z.coerce.number().int().min(0).max(1000).optional().default(100),
  isActive: z.coerce.boolean().optional().default(true),
})

export function validateRoutePayload(body: Record<string, unknown>): ValidateResult {
  const parsed = RoutePayload.safeParse(body)
  if (!parsed.success) {
    return { ok: false, reason: firstReason(parsed.error) }
  }
  return {
    ok: true,
    tenantName: parsed.data.tenantName,
    match: normalizeMatch(parsed.data.match),
    channels: normalizeChannels(parsed.data.channels),
    escalation: parsed.data.escalation.map((s) => ({
      afterMin: s.afterMin,
      channels: normalizeChannels(s.channels),
    })),
    dedupWindowMin: parsed.data.dedupWindowMin,
    priority: parsed.data.priority,
    isActive: parsed.data.isActive,
  }
}

function normalizeChannels(list: ChannelConfig[]): NormalizedChannel[] {
  return list.map((c): NormalizedChannel => {
    switch (c.type) {
      case "slack":
      case "teams":
        return { type: c.type, webhookUrl: c.webhookUrl }
      case "email": {
        const ch: NormalizedChannel = { type: "email" }
        if (c.toEmails && c.toEmails.length > 0) ch.toEmails = c.toEmails
        if (c.ccEmails && c.ccEmails.length > 0) ch.ccEmails = c.ccEmails
        if (c.oncallScheduleId) ch.oncallScheduleId = c.oncallScheduleId
        return ch
      }
      case "sms": {
        const ch: NormalizedChannel = { type: "sms" }
        if (c.phoneNumbers && c.phoneNumbers.length > 0) ch.phoneNumbers = c.phoneNumbers
        if (c.oncallScheduleId) ch.oncallScheduleId = c.oncallScheduleId
        return ch
      }
      case "pagerduty":
        return { type: "pagerduty", integrationKey: c.integrationKey }
      case "ticket":
        return { type: "ticket" }
    }
  })
}

function firstReason(err: z.ZodError): string {
  const first = err.issues[0]
  if (!first) return "invalid payload"
  const path = first.path.length > 0 ? `${first.path.join(".")}: ` : ""
  return `${path}${first.message}`
}
