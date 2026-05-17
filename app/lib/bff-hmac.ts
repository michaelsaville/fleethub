import "server-only"
import {
  verifyTimestampedBody,
  type VerifyResult as SharedVerifyResult,
} from "./hmac"

/**
 * Inbound HMAC verifier — same scheme as OpsHub. Phase 8 WS-C
 * consolidated the kernel into `lib/hmac/`; this thin wrapper
 * preserves the original `verifyHmac(rawBody, sig, ts, secret)`
 * signature so callers downstream don't need to know about the
 * options-bag shape.
 */

export type VerifyResult = SharedVerifyResult

export function verifyHmac(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secret: string,
): VerifyResult {
  return verifyTimestampedBody({
    rawBody,
    signatureHeader,
    timestampHeader,
    secret,
  })
}
