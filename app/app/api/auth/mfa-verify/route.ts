import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { verifyTotp, consumeRecoveryCode } from "@/lib/mfa"
import { mintMfaCookieValue, MFA_COOKIE_NAME } from "@/lib/mfa-cookie"
import { writeAudit } from "@/lib/audit"

// Phase 10 WS-E — verifies a TOTP or recovery code, sets the
// fleethub_mfa_cleared cookie, audits the outcome. The middleware
// reads this cookie on subsequent requests to skip the challenge.
//
// Phase 11 WS-C.2 hardening:
//  - Field-based routing: caller sends { code: "123456" } OR
//    { recoveryCode: "ABCD-EFGH" }, not a single overloaded `token`
//    field with length-based heuristic. Old `token` field still
//    accepted as alias for `code` for one-release back-compat.
//  - 5-strike lockout: mfaFailCount + mfaLockedUntil on Fl_StaffUser.
//    Counter resets on success; lockedUntil blocks for 15 minutes
//    after 5 failures within the lockout window.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const LOCKOUT_THRESHOLD = 5
const LOCKOUT_MINUTES = 15

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 })
  }
  const userId = (session.user as { id?: string }).id
  if (!userId) {
    return NextResponse.json({ error: "session has no user id" }, { status: 500 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    code?: string
    recoveryCode?: string
    /// Phase 10 legacy field; accepted as alias for `code`.
    token?: string
  }

  const user = await prisma.fl_StaffUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      totpSecret: true,
      totpEnabledAt: true,
      recoveryCodesJson: true,
      mfaFailCount: true,
      mfaLockedUntil: true,
    },
  })
  if (!user || !user.totpEnabledAt || !user.totpSecret) {
    return NextResponse.json({ error: "MFA not enrolled" }, { status: 400 })
  }

  // Lockout gate. Anything past mfaLockedUntil is a no-go regardless
  // of code correctness — operator must wait it out (or admin
  // intervention).
  if (user.mfaLockedUntil && user.mfaLockedUntil.getTime() > Date.now()) {
    await writeAudit({
      actorEmail: user.email,
      action: "mfa.challenge.locked-out",
      outcome: "error",
      detail: { unlocksAtMs: user.mfaLockedUntil.getTime() },
    }).catch(() => {})
    return NextResponse.json(
      { error: "account temporarily locked due to repeated MFA failures" },
      { status: 423 },
    )
  }

  // Field-based routing — recoveryCode is its own field, not a
  // length-heuristic over `code`. `token` is the legacy alias.
  const totpCode = (body.code ?? body.token ?? "").trim()
  const recoveryCode = (body.recoveryCode ?? "").trim()
  const tried: "totp" | "recovery" | "neither" = totpCode
    ? "totp"
    : recoveryCode
    ? "recovery"
    : "neither"

  let cleared = false
  let usedRecovery = false

  if (tried === "totp" && totpCode.length === 6) {
    if (verifyTotp(totpCode, user.totpSecret)) {
      cleared = true
    }
  } else if (tried === "recovery" && user.recoveryCodesJson) {
    try {
      const hashed = JSON.parse(user.recoveryCodesJson) as string[]
      const remaining = await consumeRecoveryCode(recoveryCode, hashed)
      if (remaining !== null) {
        await prisma.fl_StaffUser.update({
          where: { id: user.id },
          data: { recoveryCodesJson: JSON.stringify(remaining) },
        })
        cleared = true
        usedRecovery = true
      }
    } catch {
      // ignore — falls through to the 401 below
    }
  }

  if (!cleared) {
    // Increment fail counter; lock out at threshold.
    const nextCount = (user.mfaFailCount ?? 0) + 1
    const justLocked = nextCount >= LOCKOUT_THRESHOLD
    await prisma.fl_StaffUser.update({
      where: { id: user.id },
      data: {
        mfaFailCount: nextCount,
        mfaLockedUntil: justLocked
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : user.mfaLockedUntil,
      },
    })
    await writeAudit({
      actorEmail: user.email,
      action: "mfa.challenge.fail",
      outcome: "error",
      detail: { tried, failCount: nextCount },
    }).catch(() => {})
    if (justLocked) {
      await writeAudit({
        actorEmail: user.email,
        action: "mfa.locked",
        outcome: "error",
        detail: { unlockMinutes: LOCKOUT_MINUTES },
      }).catch(() => {})
    }
    return NextResponse.json(
      { error: justLocked ? "account locked due to repeated MFA failures" : "code mismatch" },
      { status: justLocked ? 423 : 401 },
    )
  }

  // Success — reset counter, mint cookie.
  if (user.mfaFailCount > 0 || user.mfaLockedUntil) {
    await prisma.fl_StaffUser.update({
      where: { id: user.id },
      data: { mfaFailCount: 0, mfaLockedUntil: null },
    })
  }

  const cookie = await mintMfaCookieValue(user.id)
  const cookieStore = await cookies()
  cookieStore.set(MFA_COOKIE_NAME, cookie.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: cookie.maxAge,
    path: "/",
  })

  await writeAudit({
    actorEmail: user.email,
    action: usedRecovery ? "mfa.challenge.recovery-used" : "mfa.challenge.ok",
    outcome: "ok",
    detail: { userId: user.id },
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
