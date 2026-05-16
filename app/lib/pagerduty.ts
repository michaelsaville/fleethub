import "server-only"

// Phase 7 Workstream A step 6 — PagerDuty Events API v2 adapter.
// Per design §3.3: integration key lives on the channel config,
// not in env, so multi-team MSPs can route different clients to
// different PagerDuty services from one FleetHub install.
//
// Events API v2 endpoint is fixed at events.pagerduty.com/v2/
// enqueue and uses the routing_key in the request body for
// auth — no Authorization header needed.

const ENQUEUE_URL = "https://events.pagerduty.com/v2/enqueue"

export interface PdAlert {
  id: string
  clientName: string
  deviceId: string | null
  kind: string
  severity: string
  title: string
}

export interface SendPdResult {
  /** PagerDuty echoes back the dedup_key it stored — we send
   *  alert.id and they confirm it. Saved into Fl_AlertDispatch
   *  .externalId for traceability + future "resolve when ack'd"
   *  callbacks. */
  dedupKey: string
}

/**
 * Trigger a PagerDuty incident. Same alert.id → same dedup_key
 * → PagerDuty merges escalation-step events into a single
 * incident automatically, which is exactly what we want.
 *
 * Throws on non-2xx. Caller records state=failed with the throw
 * message in the dispatch row's errorReason.
 */
export async function sendAlertToPagerDuty(
  integrationKey: string,
  alert: PdAlert,
): Promise<SendPdResult> {
  const base = (process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com").replace(/\/$/, "")
  const alertUrl = `${base}/alerts/${alert.id}`
  const deviceUrl = alert.deviceId ? `${base}/devices/${alert.deviceId}` : null

  const payload = {
    routing_key: integrationKey,
    event_action: "trigger",
    dedup_key: alert.id,
    payload: {
      summary: `[${alert.clientName}] ${alert.title}`,
      severity: mapSeverity(alert.severity),
      source: alert.clientName,
      component: alert.deviceId ?? undefined,
      group: "fleethub",
      class: alert.kind,
      custom_details: {
        kind: alert.kind,
        severity: alert.severity,
        device_url: deviceUrl,
      },
    },
    links: [
      { href: alertUrl, text: "Open alert in FleetHub" },
      ...(deviceUrl ? [{ href: deviceUrl, text: "Open device in FleetHub" }] : []),
    ],
  }

  const res = await fetch(ENQUEUE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`PagerDuty ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = (await res.json().catch(() => ({}))) as { dedup_key?: string }
  return { dedupKey: json.dedup_key ?? alert.id }
}

function mapSeverity(s: string): "critical" | "error" | "warning" | "info" {
  switch (s) {
    case "critical": return "critical"
    case "warn":     return "warning"
    case "info":     return "info"
    default:         return "error"
  }
}

/**
 * Last 4 chars of the integration key for the dispatch
 * destination fingerprint. The full key is a 32-char
 * shared-secret-ish token — never put it in audit logs.
 */
export function redactPdKey(key: string): string {
  if (key.length <= 6) return "…"
  return `…${key.slice(-4)}`
}
