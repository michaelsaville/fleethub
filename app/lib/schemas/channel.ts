import { z } from "zod"
import { isValidWebhookUrl } from "@/lib/webhook-delivery"
import { EmailAddress } from "./email"
import { E164 } from "./e164"

// Phase 8 Workstream C §5.3 — alert-route channel discriminated
// union. Six variants today; adding Discord/ntfy is one new branch
// + matching adapter file under lib/alert-channels/.
//
// Each variant is strict on its own required fields and forwards
// to the adapter at dispatch time. Email + SMS variants accept
// either a static recipient list OR an oncallScheduleId (resolved
// at dispatch time); validator below enforces "at least one
// resolution path required".

const trimmed = (max?: number) => {
  let s = z.string().trim()
  if (max !== undefined) s = s.max(max)
  return s
}

export const SlackChannel = z.object({
  type: z.literal("slack"),
  webhookUrl: trimmed().refine(
    (s) => s.length > 0 && isValidWebhookUrl(s, "slack"),
    "webhookUrl does not look like a Slack incoming webhook",
  ),
})

export const TeamsChannel = z.object({
  type: z.literal("teams"),
  webhookUrl: trimmed().refine(
    (s) => s.length > 0 && isValidWebhookUrl(s, "teams"),
    "webhookUrl does not look like a Teams incoming webhook",
  ),
})

export const EmailChannel = z
  .object({
    type: z.literal("email"),
    toEmails: z.array(EmailAddress).optional(),
    ccEmails: z.array(EmailAddress).optional(),
    oncallScheduleId: trimmed().optional(),
  })
  .refine(
    (c) => (c.toEmails?.length ?? 0) > 0 || (c.oncallScheduleId?.length ?? 0) > 0,
    "email channel: at least one valid toEmail required (or an oncallScheduleId)",
  )

export const SmsChannel = z
  .object({
    type: z.literal("sms"),
    phoneNumbers: z.array(E164).max(20, "max 20 phone numbers per channel").optional(),
    oncallScheduleId: trimmed().optional(),
  })
  .refine(
    (c) => (c.phoneNumbers?.length ?? 0) > 0 || (c.oncallScheduleId?.length ?? 0) > 0,
    "sms channel: at least one E.164 phone number required (or an oncallScheduleId)",
  )

// PD Events-API v2 integration key is 32 hex chars; we allow 20-80
// to tolerate the operator pasting a longer key from a wrapper
// without locking the regex (PD has rotated formats once).
export const PagerDutyChannel = z.object({
  type: z.literal("pagerduty"),
  integrationKey: trimmed()
    .min(20, "integrationKey looks malformed (length < 20)")
    .max(80, "integrationKey looks malformed (length > 80)"),
})

export const TicketChannel = z.object({
  type: z.literal("ticket"),
})

export const ChannelConfig = z.discriminatedUnion("type", [
  SlackChannel,
  TeamsChannel,
  EmailChannel,
  SmsChannel,
  PagerDutyChannel,
  TicketChannel,
])

export type ChannelConfig = z.infer<typeof ChannelConfig>

/// Channel list shape used on every Fl_AlertRoute and on each
/// step of an escalation chain. v1 caps at 10 channels per slot.
export const ChannelList = z
  .array(ChannelConfig)
  .min(1, "at least one channel is required")
  .max(10, "max 10 channels")

/// Phase 10 WS-B §4.3 — read-side safe parse for Fl_AlertRoute.channelsJson.
/// Same pattern as safeParseMatchJson in match.ts. Returns a
/// discriminated result so dispatch can surface malformed-channel
/// audit rows instead of silently `continue`-ing.
export type SafeParseChannelsResult =
  | { ok: true; channels: ChannelConfig[] }
  | { ok: false; reason: string }

export function safeParseChannelsJson(json: string): SafeParseChannelsResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = ChannelList.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `channels shape mismatch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    }
  }
  return { ok: true, channels: parsed.data }
}
