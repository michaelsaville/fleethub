import "server-only"
import { sendAlertSms, redactPhone } from "@/lib/sms-twilio"
import { resolveCurrentOncall } from "@/lib/oncall"
import type { AlertChannelAdapter } from "./types"

// Phase 8 Workstream C §5.2 — SMS adapter. Recipient resolution
// (oncall vs static list) lives in send because on-call resolution
// hits the DB. Fingerprint matches the pre-refactor format:
// "N SMS · last4(first-number) (on-call optional)".

export const smsAdapter: AlertChannelAdapter = {
  type: "sms",
  async send(alert, config) {
    let numbers: string[] = []
    let oncallSuffix = ""

    if (typeof config.oncallScheduleId === "string" && config.oncallScheduleId.trim()) {
      const resolved = await resolveCurrentOncall(config.oncallScheduleId.trim())
      if (!resolved) {
        throw new Error("on-call resolver returned no user (inactive schedule / unscheduled time / inactive user)")
      }
      if (!resolved.user.phoneE164) {
        throw new Error(`on-call user "${resolved.user.email}" has no phoneE164 set`)
      }
      numbers = [resolved.user.phoneE164]
      oncallSuffix = ` (on-call${resolved.fromOverride ? " override" : ""})`
    } else {
      numbers = Array.isArray(config.phoneNumbers)
        ? config.phoneNumbers.filter((s): s is string => typeof s === "string" && s.trim() !== "")
        : []
    }
    if (numbers.length === 0) {
      throw new Error("no phoneNumbers configured")
    }

    const destination = `${numbers.length} SMS · ${redactPhone(numbers[0])}${oncallSuffix}`
    await sendAlertSms(numbers, {
      id: alert.id,
      clientName: alert.clientName,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
    })
    return { destination }
  },
}
