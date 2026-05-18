import "server-only"
import { postAlertToSlack } from "@/lib/webhook-delivery"
import { unsealForSystemUse } from "@/lib/credential-vault"
import type { AlertChannelAdapter, ChannelConfig } from "./types"

// Phase 8 Workstream C §5.2 — Slack adapter. Fingerprint = first 32
// chars of the webhook URL (matches the pre-refactor format).
//
// Phase 11 WS-A.5 — webhook URL may now live in the vault as a
// Fl_Credential row instead of inline plaintext. When `credentialId`
// is set on the channel config, we resolve via unsealForSystemUse
// at send time. Legacy plaintext `webhookUrl` still works (migration
// is idempotent and may be run in stages).

type SlackChannelConfig = ChannelConfig & {
  credentialId?: string
  /// Optional UI-facing fingerprint when credentialId is in use
  /// (so the route editor can show "Slack #ops (…/T0A1B/B9X9Z)").
  masked?: string
}

async function resolveWebhookUrl(config: SlackChannelConfig): Promise<string> {
  if (config.credentialId) {
    const { plaintext } = await unsealForSystemUse({
      credentialId: config.credentialId,
      context: "system:alert-channels",
    })
    return plaintext.trim()
  }
  return (config.webhookUrl ?? "").trim()
}

export const slackAdapter: AlertChannelAdapter<SlackChannelConfig> = {
  type: "slack",
  preflight(config) {
    // We can't unseal here (preflight is sync). Just check that
    // SOMETHING is configured — the credentialId resolution failure
    // surfaces at send-time as an exception, which the dispatcher
    // records as state="failed".
    if (config.credentialId) return null
    const url = (config.webhookUrl ?? "").trim()
    if (!url) return "no webhookUrl configured"
    return null
  },
  async send(alert, config) {
    const url = await resolveWebhookUrl(config)
    if (!url) {
      throw new Error("slack: empty webhook URL after vault resolve")
    }
    await postAlertToSlack(url, alert)
    // Fingerprint: prefer operator-supplied mask when in vault mode;
    // fall back to URL prefix.
    const fingerprint = config.credentialId
      ? `vault:${config.credentialId.slice(0, 8)} ${config.masked ?? ""}`.trim()
      : url.slice(0, 32) + "…"
    return { destination: fingerprint }
  },
}
