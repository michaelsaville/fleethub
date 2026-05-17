import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

// Phase 8 Workstream C §5.4 — shared HMAC kernel. Three patterns
// existed across the app before this consolidation:
//   A) timestamped body: hex(`${ts}.${body}` with sha256= prefix)
//   B) compound-string token: hex(message), optionally truncated
//   C) raw-body HMAC over headers (no timestamp)
//
// This file is the kernel for all three. Pattern A gets dedicated
// helpers in ./timestamped-body.ts; B and C compose directly from
// hmacHex + safeEqualHex.

/** HMAC-SHA256(message, secret) → lowercase hex. */
export function hmacHex(message: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex")
}

/** HMAC-SHA256(message, secret) → standard base64 (with padding). */
export function hmacBase64(message: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("base64")
}

/** Timing-safe equal between two hex-encoded digests. Returns false
 *  for invalid hex or length mismatch — both indicate tamper or
 *  wrong-secret, not a programmer error. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let ab: Buffer, bb: Buffer
  try {
    ab = Buffer.from(a, "hex")
    bb = Buffer.from(b, "hex")
  } catch {
    return false
  }
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Timing-safe equal between two base64-encoded digests. Tolerates
 *  the `=` padding being trimmed (some senders strip it) by
 *  normalizing both inputs before compare. */
export function safeEqualBase64(a: string, b: string): boolean {
  if (!a || !b) return false
  let ab: Buffer, bb: Buffer
  try {
    ab = Buffer.from(a, "base64")
    bb = Buffer.from(b, "base64")
  } catch {
    return false
  }
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
