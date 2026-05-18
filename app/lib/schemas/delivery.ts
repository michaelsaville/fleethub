import { z } from "zod"
import { isValidWebhookUrl } from "@/lib/webhook-delivery"

// Phase 10 WS-B §4.3 — zod schema + safeParse for
// Fl_ReportSchedule.deliveryJson. Three optional channels: email,
// slack, teams. Validator in /api/report-schedules requires at
// least one. Read-side safeParse lets the cron worker write a
// "delivery.skip.malformed" audit row instead of silently failing
// when a row is hand-edited via SQL.

const EmailDelivery = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
})

const SlackDelivery = z.object({
  webhookUrl: z
    .string()
    .refine((s) => isValidWebhookUrl(s, "slack"), "not a Slack incoming webhook"),
})

const TeamsDelivery = z.object({
  webhookUrl: z
    .string()
    .refine((s) => isValidWebhookUrl(s, "teams"), "not a Teams incoming webhook"),
})

export const DeliveryConfig = z
  .object({
    email: EmailDelivery.optional(),
    slack: SlackDelivery.optional(),
    teams: TeamsDelivery.optional(),
  })
  .refine(
    (c) => c.email !== undefined || c.slack !== undefined || c.teams !== undefined,
    "at least one delivery channel required",
  )

export type DeliveryConfig = z.infer<typeof DeliveryConfig>

export type SafeParseDeliveryResult =
  | { ok: true; delivery: DeliveryConfig }
  | { ok: false; reason: string }

export function safeParseDeliveryJson(json: string): SafeParseDeliveryResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = DeliveryConfig.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `delivery shape mismatch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    }
  }
  return { ok: true, delivery: parsed.data }
}
