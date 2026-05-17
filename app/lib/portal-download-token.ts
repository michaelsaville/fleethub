import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

// Phase 8 Workstream D step 6.2 — short-lived signed URL for the
// customer portal's per-report download links. Same secret as the
// HMAC BFF (PORTAL_BFF_SECRET), but a different signing surface:
// the BFF signs request bodies; this signs URL params.
//
// Format: ?t=<expMs>&s=<hex-hmac-of(reportId.expMs)>
// Default validity: 5 minutes. Tenant binding is enforced by the
// BFF refusing to mint a token for a report on a different client;
// the download route only validates exp + signature (the report id
// in the URL is the binding).

const DEFAULT_TTL_MS = 5 * 60 * 1000

export function mintReportDownloadToken(
  reportId: string,
  secret: string,
  ttlMs: number = DEFAULT_TTL_MS,
): { t: string; s: string } {
  const exp = String(Date.now() + ttlMs)
  const sig = createHmac("sha256", secret).update(`${reportId}.${exp}`).digest("hex")
  return { t: exp, s: sig }
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string; status: number }

export function verifyReportDownloadToken(
  reportId: string,
  t: string | null,
  s: string | null,
  secret: string,
): VerifyResult {
  if (!secret) return { ok: false, reason: "secret not configured on server", status: 500 }
  if (!t || !s) return { ok: false, reason: "missing token params", status: 401 }
  const expMs = parseInt(t, 10)
  if (!Number.isFinite(expMs)) return { ok: false, reason: "invalid token timestamp", status: 401 }
  if (Date.now() > expMs) return { ok: false, reason: "token expired", status: 401 }

  const expected = createHmac("sha256", secret).update(`${reportId}.${t}`).digest("hex")
  const expectedBuf = Buffer.from(expected, "hex")
  let providedBuf: Buffer
  try {
    providedBuf = Buffer.from(s, "hex")
  } catch {
    return { ok: false, reason: "invalid token signature", status: 401 }
  }
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: "signature mismatch", status: 401 }
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: "signature mismatch", status: 401 }
  }
  return { ok: true }
}
