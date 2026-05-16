import "server-only"

// Phase 7 Workstream C — RustDesk integration.
//
// Two modes, picked at request time from env vars:
//
// PRO MODE — when both env vars are set:
//   RUSTDESK_API_URL=https://rustdesk.pcc2k.com/api
//   RUSTDESK_API_TOKEN=<bearer-token-from-pro-admin>
// The lib talks to the management API to mint per-session
// tokens + query session state. Operators never see the
// device's permanent password.
//
// FREE MODE — when either env var is missing:
//   The lib falls back to operator-asserted lifecycle. The
//   "Remote in" button hands the operator a `rustdesk://` deep
//   link with the device's stored rustdeskId; the operator's
//   local client handles auth via its own saved password.
//   Session start + end are operator-asserted clicks on the
//   FleetHub side (not API-confirmed).
//
// The hybrid is intentional: the FleetHub-side UI surface +
// audit lineage are identical between modes. Activating Pro is
// a one-line env change + container restart — no schema
// migration, no UI rebuild.

export type RustDeskMode = "pro" | "free"

export function rustDeskMode(): RustDeskMode {
  const url = process.env.RUSTDESK_API_URL?.trim()
  const token = process.env.RUSTDESK_API_TOKEN?.trim()
  return url && token ? "pro" : "free"
}

export function rustDeskBaseUrl(): string {
  return (process.env.RUSTDESK_API_URL?.trim() || "").replace(/\/$/, "")
}

export interface MintTokenInput {
  deviceRustdeskId: string
  operatorEmail: string
  /** Minutes the access token is valid for; tokens are short-lived. */
  ttlMin: number
}

export interface MintTokenResult {
  /** Raw access token. NEVER persist this — only the bcrypt hash. */
  accessToken: string
  /** RustDesk-side session id, surfaced to the audit row. */
  rustdeskSessionId: string
  /** Absolute expiry the caller should store in accessTokenExpiresAt. */
  expiresAt: Date
}

/**
 * Mint a per-session access token via the RustDesk Pro management
 * API. Caller is responsible for bcrypt-hashing accessToken before
 * persisting + constructing the deep link the operator clicks.
 *
 * Throws RustDeskFreeMode when no Pro license is configured —
 * caller catches and falls back to the operator-asserted path.
 */
export async function mintAccessToken(input: MintTokenInput): Promise<MintTokenResult> {
  if (rustDeskMode() !== "pro") {
    throw new RustDeskFreeMode("RUSTDESK_API_URL + RUSTDESK_API_TOKEN not set — running in free mode")
  }
  const base = rustDeskBaseUrl()
  const token = process.env.RUSTDESK_API_TOKEN!.trim()
  // RustDesk Pro's "Peer connection token" endpoint shape is
  // documented loosely; this matches the v1.2.x admin api. If
  // the field names drift in a future release, this is the one
  // file to update.
  const res = await fetch(`${base}/peer/${encodeURIComponent(input.deviceRustdeskId)}/token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operator: input.operatorEmail,
      ttl_minutes: input.ttlMin,
    }),
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`RustDesk Pro mintAccessToken ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string
    session_id?: string
    expires_at?: string
  }
  if (!json.access_token || !json.session_id) {
    throw new Error("RustDesk Pro mintAccessToken returned unexpected shape")
  }
  const expiresAt = json.expires_at
    ? new Date(json.expires_at)
    : new Date(Date.now() + input.ttlMin * 60_000)
  return {
    accessToken: json.access_token,
    rustdeskSessionId: json.session_id,
    expiresAt,
  }
}

export interface SessionStateResult {
  state: "active" | "ended" | "unknown"
  bytesTransferred: number | null
  endedAt: Date | null
}

/**
 * Poll the RustDesk Pro API for a session's state. Used by the
 * session-watcher cron to flip Fl_RemoteSession.state to
 * "closed" when the actual disconnect happens.
 *
 * Throws RustDeskFreeMode in free mode — the cron skips polling
 * in that case (operator-asserted close drives the lifecycle).
 */
export async function queryRustDeskSession(sessionId: string): Promise<SessionStateResult> {
  if (rustDeskMode() !== "pro") {
    throw new RustDeskFreeMode("free mode — session state is operator-asserted")
  }
  const base = rustDeskBaseUrl()
  const token = process.env.RUSTDESK_API_TOKEN!.trim()
  const res = await fetch(`${base}/session/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (res.status === 404) {
    return { state: "ended", bytesTransferred: null, endedAt: new Date() }
  }
  if (!res.ok) {
    throw new Error(`RustDesk Pro querySession ${res.status}: ${await res.text().catch(() => "").then((t) => t.slice(0, 200))}`)
  }
  const json = (await res.json().catch(() => ({}))) as {
    state?: string
    bytes_transferred?: number
    ended_at?: string
  }
  const state: SessionStateResult["state"] =
    json.state === "active" ? "active" :
    json.state === "ended" ? "ended" :
    "unknown"
  return {
    state,
    bytesTransferred: typeof json.bytes_transferred === "number" ? json.bytes_transferred : null,
    endedAt: json.ended_at ? new Date(json.ended_at) : null,
  }
}

export class RustDeskFreeMode extends Error {
  readonly mode = "free" as const
  constructor(message: string) {
    super(message)
    this.name = "RustDeskFreeMode"
  }
}

/**
 * Build the rustdesk:// deep link an operator clicks to open
 * their local RustDesk client against a target peer. Works in
 * both modes — in Pro mode the access token rides in the URL;
 * in free mode the URL just carries the peer id and the
 * operator's saved client handles auth.
 */
export function rustDeskDeepLink(deviceRustdeskId: string, accessToken: string | null): string {
  if (accessToken) {
    return `rustdesk://${encodeURIComponent(deviceRustdeskId)}?token=${encodeURIComponent(accessToken)}`
  }
  return `rustdesk://${encodeURIComponent(deviceRustdeskId)}`
}
