import "server-only"
import { postAlertToSlack } from "@/lib/webhook-delivery"
import type { AlertChannelAdapter } from "./types"

// Phase 8 Workstream C §5.2 — Slack adapter. Fingerprint = first 32
// chars of the webhook URL (matches the pre-refactor format).

export const slackAdapter: AlertChannelAdapter = {
  type: "slack",
  preflight(config) {
    const url = (config.webhookUrl ?? "").trim()
    if (!url) return "no webhookUrl configured"
    return null
  },
  async send(alert, config) {
    const url = (config.webhookUrl ?? "").trim()
    await postAlertToSlack(url, alert)
    return { destination: url.slice(0, 32) + "…" }
  },
}
