import "server-only"
import { sendAlertToPagerDuty, redactPdKey } from "@/lib/pagerduty"
import type { AlertChannelAdapter } from "./types"

// Phase 8 Workstream C §5.2 — PagerDuty adapter. Sync preflight on
// the integrationKey; send returns the dedup key as externalId so
// the Fl_AlertDispatch.externalId column reflects PD's idempotency
// surface.

export const pagerdutyAdapter: AlertChannelAdapter = {
  type: "pagerduty",
  preflight(config) {
    const key = typeof config.integrationKey === "string" ? config.integrationKey.trim() : ""
    if (!key) return "no integrationKey configured"
    return null
  },
  async send(alert, config) {
    const key = (config.integrationKey as string).trim()
    const { dedupKey } = await sendAlertToPagerDuty(key, {
      id: alert.id,
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
    })
    return {
      destination: `pd ${redactPdKey(key)}`,
      externalId: dedupKey,
    }
  },
}
