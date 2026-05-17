import "server-only"

// Single entry point for HMAC primitives. New callers should import
// from `@/lib/hmac` rather than reaching for node:crypto directly,
// so signature shape + replay-window behavior stays uniform.

export { hmacHex, hmacBase64, safeEqualHex, safeEqualBase64 } from "./core"
export {
  signTimestampedBody,
  verifyTimestampedBody,
  type SignedRequest,
  type VerifyOptions,
  type VerifyResult,
} from "./timestamped-body"
