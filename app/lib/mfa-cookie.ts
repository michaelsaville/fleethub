// Phase 10 WS-E — MFA-cleared cookie. After /api/auth/mfa-verify
// succeeds, we set an HTTP-only signed cookie that lets the
// middleware skip the challenge until expiry. JWT mode doesn't
// have a session table to flip a flag on, and NextAuth's update()
// can't be triggered from the server.
//
// Cookie value: `${userId}.${expMs}.${hex-sig}` where sig =
// HMAC-SHA256(`${userId}.${expMs}`, NEXTAUTH_SECRET).
//
// Uses Web Crypto (SubtleCrypto) rather than node:crypto so this
// module loads in both Node and Edge runtimes — middleware runs
// on Edge by default.

export const MFA_COOKIE_NAME = "fleethub_mfa_cleared"
const TTL_MS = 12 * 60 * 60_000 // 12 hours — operator-friendly default

function secret(): string {
  const v = process.env.NEXTAUTH_SECRET?.trim()
  if (!v) throw new Error("NEXTAUTH_SECRET not configured — MFA cookie can't be minted")
  return v
}

async function hmacSha256Hex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function mintMfaCookieValue(
  userId: string,
  ttlMs: number = TTL_MS,
): Promise<{ value: string; maxAge: number }> {
  const exp = Date.now() + ttlMs
  const payload = `${userId}.${exp}`
  const sig = await hmacSha256Hex(payload, secret())
  return { value: `${payload}.${sig}`, maxAge: Math.floor(ttlMs / 1000) }
}

export type VerifyMfaCookieResult =
  | { ok: true; userId: string }
  | { ok: false; reason: string }

export async function verifyMfaCookieValue(
  cookieValue: string | undefined | null,
): Promise<VerifyMfaCookieResult> {
  if (!cookieValue) return { ok: false, reason: "missing" }
  const parts = cookieValue.split(".")
  if (parts.length !== 3) return { ok: false, reason: "malformed" }
  const [userId, expStr, sig] = parts
  const exp = parseInt(expStr, 10)
  if (!Number.isFinite(exp)) return { ok: false, reason: "invalid exp" }
  if (Date.now() > exp) return { ok: false, reason: "expired" }
  let expected: string
  try {
    expected = await hmacSha256Hex(`${userId}.${expStr}`, secret())
  } catch {
    return { ok: false, reason: "server not configured" }
  }
  // Constant-time-ish compare — same length + char-by-char.
  if (expected.length !== sig.length) return { ok: false, reason: "signature mismatch" }
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  }
  if (diff !== 0) return { ok: false, reason: "signature mismatch" }
  return { ok: true, userId }
}
