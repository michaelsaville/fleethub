import "server-only"
import { OTP, generateSecret as otpGenerateSecret } from "otplib"
import { randomBytes, scrypt as scryptCb } from "node:crypto"
import { promisify } from "node:util"

// Phase 9 WS-B §4.6 — TOTP MFA helpers.
//
// Server-side: enroll generates a base32 secret + 10 recovery codes
// (scrypt-hashed, returned plaintext only at enroll time).
// verify(secret, token) checks both TOTP and recovery codes.

const scrypt = promisify(scryptCb)

// otplib v13 OTP wrapper class. strategy="totp" + per-call options
// keeps things simple — digits/period are passed on each call so
// the class instance carries no per-user state.
const otp = new OTP({ strategy: "totp" })

const TOTP_OPTS = { digits: 6 as const, period: 30 }

export function generateSecret(): string {
  return otpGenerateSecret({ length: 20 })
}

export function otpauthUrl(email: string, secret: string): string {
  return otp.generateURI({
    issuer: "FleetHub",
    label: email,
    secret,
    ...TOTP_OPTS,
  })
}

export function verifyTotp(token: string, secret: string): boolean {
  if (!token || token.length !== 6) return false
  try {
    // ±30s tolerance (one period either side) covers clock skew.
    const result = otp.verifySync({
      secret,
      token,
      ...TOTP_OPTS,
      epochTolerance: 30,
    })
    return result.valid === true
  } catch {
    return false
  }
}

/// 10 8-char recovery codes, returned plaintext once + scrypt-hashed
/// for storage. Each can be consumed exactly once.
export interface RecoveryCodeBundle {
  plaintext: string[]
  hashed: string[]
}

export async function generateRecoveryCodes(count = 10): Promise<RecoveryCodeBundle> {
  const plaintext: string[] = []
  const hashed: string[] = []
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(6).toString("hex").slice(0, 8).toUpperCase()
    plaintext.push(raw)
    hashed.push(await hashCode(raw))
  }
  return { plaintext, hashed }
}

async function hashCode(plaintext: string): Promise<string> {
  const salt = randomBytes(16).toString("hex")
  const derived = (await scrypt(plaintext, salt, 32)) as Buffer
  return `${salt}:${derived.toString("hex")}`
}

/// Verifies + consumes a recovery code. Returns the new (remaining)
/// hash list when matched; null when not.
export async function consumeRecoveryCode(
  token: string,
  hashedList: string[],
): Promise<string[] | null> {
  if (!token) return null
  const normalized = token.trim().toUpperCase()
  for (let i = 0; i < hashedList.length; i++) {
    const entry = hashedList[i]
    const [salt, expected] = entry.split(":")
    if (!salt || !expected) continue
    const derived = (await scrypt(normalized, salt, 32)) as Buffer
    if (derived.toString("hex") === expected) {
      const next = hashedList.slice()
      next.splice(i, 1)
      return next
    }
  }
  return null
}
