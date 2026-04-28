import "server-only"
import { createHmac } from "node:crypto"

/**
 * Outbound HMAC-signed POSTs from FleetHub → TicketHub BFF. Different
 * caller identity from OpsHub (separate secret + headers) so a leaked
 * OpsHub secret can't forge FleetHub calls.
 *
 *   X-Fl-Timestamp: <unix-ms>
 *   X-Fl-Signature: sha256=<hex>
 *   secret: FL_BFF_SECRET (TH side reads this for fleet caller routes)
 *
 * Phase 1 unused — TH doesn't expose any fleet-targeted BFF routes
 * yet. Wired up because we'll need it the moment FleetHub starts
 * reading TicketHub's client list.
 */

interface CallOpts {
  path: string
  body?: unknown
}

export class BffCallError extends Error {
  constructor(public status: number, public payload: unknown) {
    super(`TH BFF call failed (${status})`)
  }
}

export async function callTickethubBff<T = unknown>(opts: CallOpts): Promise<T> {
  const secret = process.env.FL_BFF_SECRET
  const baseUrl = process.env.TICKETHUB_BASE_URL
  if (!secret) throw new Error("FL_BFF_SECRET not set on FleetHub")
  if (!baseUrl) throw new Error("TICKETHUB_BASE_URL not set on FleetHub")

  const rawBody = opts.body === undefined ? "" : JSON.stringify(opts.body)
  const ts = Date.now().toString()
  const sig = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${opts.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Fl-Timestamp": ts,
      "X-Fl-Signature": `sha256=${sig}`,
    },
    body: rawBody,
    cache: "no-store",
  })

  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!res.ok) throw new BffCallError(res.status, parsed)
  return parsed as T
}
