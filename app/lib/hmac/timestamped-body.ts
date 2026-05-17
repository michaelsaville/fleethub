import "server-only"
import { hmacHex, safeEqualHex } from "./core"

// Pattern A — `${ts}.${rawBody}` signing with optional `sha256=`
// header prefix + replay-window verification. Used by:
//   - inbound /api/agent-ingest (verify)
//   - bff-th-client (outbound to TicketHub, sign)
//   - agent-dispatch (outbound to PCC2K gateway, sign)
//
// The wire shape is shared across all three; the differences are
// just header names and the secret env var — both supplied by the
// caller.

const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000
const DEFAULT_SIGNATURE_PREFIX = "sha256="

export interface SignedRequest {
  /** Stringified Date.now() — assign to the timestamp header. */
  ts: string
  /** Hex digest. Caller decides whether to prepend `sha256=`. */
  sigHex: string
  /** Convenience: prefixed signature for headers that expect it
   *  (e.g. `X-Fl-Signature: sha256=…`). */
  sigHeader: string
}

/** Sign the canonical `${ts}.${rawBody}` payload. */
export function signTimestampedBody(
  rawBody: string,
  secret: string,
  opts: { signaturePrefix?: string } = {},
): SignedRequest {
  const prefix = opts.signaturePrefix ?? DEFAULT_SIGNATURE_PREFIX
  const ts = String(Date.now())
  const sigHex = hmacHex(`${ts}.${rawBody}`, secret)
  return { ts, sigHex, sigHeader: `${prefix}${sigHex}` }
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string; status: number }

export interface VerifyOptions {
  /** Raw request body (string — JSON or empty). */
  rawBody: string
  /** Signature header value as received (may include `sha256=` prefix). */
  signatureHeader: string | null
  /** Timestamp header value as received (unix ms string). */
  timestampHeader: string | null
  /** Shared secret. Empty string → 500 "secret not configured". */
  secret: string
  /** Override the ±window. Default 5 minutes. */
  replayWindowMs?: number
  /** Override the prefix. Default "sha256=". Pass "" to accept bare hex. */
  signaturePrefix?: string
}

/** Verify the canonical `${ts}.${rawBody}` payload. */
export function verifyTimestampedBody(opts: VerifyOptions): VerifyResult {
  const {
    rawBody,
    signatureHeader,
    timestampHeader,
    secret,
    replayWindowMs = DEFAULT_REPLAY_WINDOW_MS,
    signaturePrefix = DEFAULT_SIGNATURE_PREFIX,
  } = opts

  if (!secret) return { ok: false, reason: "secret not configured on server", status: 500 }
  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: "missing signature or timestamp header", status: 401 }
  }
  if (signaturePrefix && !signatureHeader.startsWith(signaturePrefix)) {
    return { ok: false, reason: "unsupported signature format", status: 401 }
  }

  const ts = parseInt(timestampHeader, 10)
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp", status: 401 }
  const skew = Math.abs(Date.now() - ts)
  if (skew > replayWindowMs) {
    return { ok: false, reason: `timestamp outside ±${replayWindowMs / 1000}s window`, status: 401 }
  }

  const expected = hmacHex(`${ts}.${rawBody}`, secret)
  const provided = signaturePrefix
    ? signatureHeader.slice(signaturePrefix.length)
    : signatureHeader

  if (!safeEqualHex(expected, provided)) {
    return { ok: false, reason: "signature mismatch", status: 401 }
  }

  return { ok: true }
}
