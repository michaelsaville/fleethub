import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Inbound HMAC verifier — same scheme as OpsHub. Phase 0 unused; the
 * Phase 2 agent (PCC2K-Agent) will be the first caller, signing each
 * command result with FLEETHUB_AGENT_SECRET.
 */

const REPLAY_WINDOW_MS = 5 * 60 * 1000
const SIGNATURE_PREFIX = "sha256="

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string; status: number }

export function verifyHmac(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secret: string,
): VerifyResult {
  if (!secret) return { ok: false, reason: "secret not configured on server", status: 500 }
  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: "missing signature or timestamp header", status: 401 }
  }
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { ok: false, reason: "unsupported signature format", status: 401 }
  }

  const ts = parseInt(timestampHeader, 10)
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp", status: 401 }
  const skew = Math.abs(Date.now() - ts)
  if (skew > REPLAY_WINDOW_MS) {
    return { ok: false, reason: `timestamp outside ±${REPLAY_WINDOW_MS / 1000}s window`, status: 401 }
  }

  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")
  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length)

  const expectedBuf = Buffer.from(expected, "hex")
  const providedBuf = Buffer.from(provided, "hex")
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: "signature mismatch", status: 401 }
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: "signature mismatch", status: 401 }
  }

  return { ok: true }
}
