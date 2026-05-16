import "server-only"

// Phase 7 Workstream A step 5 — Twilio SMS adapter for alert
// dispatch. Twilio is the v1 provider; alternative providers
// (Bandwidth, AWS SNS, etc.) slot in as additional adapters
// when an operator asks for one.
//
// Activation: three env vars — TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (E.164 format like
// +14155551234). When unset, twilioConfigured() returns false
// and dispatches record a clear "twilio not configured" error
// rather than silently swallowing.

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim(),
  )
}

export interface SmsAlert {
  id: string
  clientName: string
  kind: string
  severity: string
  title: string
}

export interface SendAlertSmsResult {
  /** Sids returned by Twilio per recipient, in input order. */
  messageSids: string[]
}

/**
 * POST to Twilio's Messages API once per recipient. Twilio
 * doesn't expose a bulk-send endpoint, so we fan out with
 * Promise.all and aggregate failures into one combined error
 * (the caller's catch records it as state=failed once for the
 * dispatch row, not per recipient).
 *
 * Throws on the first failure with a message that lists which
 * recipient broke. Successful sends before the failure stay
 * sent at Twilio (no rollback) — that's accepted; partial
 * delivery is better than no delivery on critical alerts.
 */
export async function sendAlertSms(
  toNumbers: string[],
  alert: SmsAlert,
): Promise<SendAlertSmsResult> {
  if (!twilioConfigured()) {
    throw new Error("Twilio not configured (need TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER)")
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const fromNumber = process.env.TWILIO_FROM_NUMBER!
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`
  const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64")
  const body = buildSmsBody(alert)

  const messageSids: string[] = []
  for (const to of toNumbers) {
    const form = new URLSearchParams()
    form.set("From", fromNumber)
    form.set("To", to)
    form.set("Body", body)
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Twilio ${res.status} for ${redactPhone(to)}: ${text.slice(0, 200)}`)
    }
    const json = (await res.json().catch(() => ({}))) as { sid?: string }
    if (json.sid) messageSids.push(json.sid)
  }
  return { messageSids }
}

/**
 * Keep SMS body tight — under one segment (160 chars) when
 * possible to avoid concatenation oddities + per-segment cost.
 * Severity prefix + client + title + short link.
 */
function buildSmsBody(alert: SmsAlert): string {
  const base = (process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com").replace(/\/$/, "")
  const link = `${base}/alerts/${alert.id}`
  const sev = alert.severity.toUpperCase()
  // Truncate the title aggressively; the body already conveys
  // severity + client, the title is the cherry-on-top context.
  const headroom = 160 - (sev.length + alert.clientName.length + link.length + 10)
  const title =
    alert.title.length > Math.max(20, headroom)
      ? alert.title.slice(0, Math.max(20, headroom) - 1) + "…"
      : alert.title
  return `${sev} ${alert.clientName}: ${title} ${link}`
}

/** Last 4 digits only for log lines + dispatch destination fingerprint. */
export function redactPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "")
  if (digits.length <= 4) return digits
  return `…${digits.slice(-4)}`
}
