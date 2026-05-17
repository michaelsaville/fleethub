import "server-only"
import { postAlertToTeams } from "@/lib/webhook-delivery"
import type { AlertChannelAdapter } from "./types"

// Phase 8 Workstream C §5.2 — Teams adapter. Mirror of Slack —
// same webhook lifecycle, different poster.

export const teamsAdapter: AlertChannelAdapter = {
  type: "teams",
  preflight(config) {
    const url = (config.webhookUrl ?? "").trim()
    if (!url) return "no webhookUrl configured"
    return null
  },
  async send(alert, config) {
    const url = (config.webhookUrl ?? "").trim()
    await postAlertToTeams(url, alert)
    return { destination: url.slice(0, 32) + "…" }
  },
}
