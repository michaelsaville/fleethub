import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

// Phase 7 Workstream A step 9 — signed ack tokens for Slack /
// Teams / email links. Holding the URL is the auth (anyone who
// has access to the notification channel has implicit ack
// authority). HMAC ensures the token came from us, not a
// guessed alert id from outside.
//
// Reuses NEXTAUTH_SECRET. Separate rotation isn't worth a
// dedicated env var until an operator asks; both are server-
// secrets bound to the same install.

function secret(): string {
  const v = process.env.NEXTAUTH_SECRET?.trim()
  if (!v) {
    throw new Error("NEXTAUTH_SECRET not configured — ack tokens can't be minted or verified")
  }
  return v
}

export function mintAckToken(alertId: string): string {
  return createHmac("sha256", secret()).update(`ack:${alertId}`).digest("hex").slice(0, 32)
}

export function verifyAckToken(alertId: string, token: string): boolean {
  let expected: string
  try {
    expected = mintAckToken(alertId)
  } catch {
    return false
  }
  const eb = Buffer.from(expected, "hex")
  const pb = Buffer.from(token, "hex")
  if (eb.length === 0 || eb.length !== pb.length) return false
  return timingSafeEqual(eb, pb)
}

/** Public ack URL embedded in Slack/Teams/email payloads. */
export function ackUrl(alertId: string): string {
  const base = (process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com").replace(/\/$/, "")
  return `${base}/api/alerts/${alertId}/ack?token=${mintAckToken(alertId)}`
}
