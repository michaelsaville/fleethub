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

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

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
    token?: string
    recoveryCode?: string
  }

  const user = await prisma.fl_StaffUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpSecret: true, totpEnabledAt: true, recoveryCodesJson: true },
  })
  if (!user || !user.totpEnabledAt || !user.totpSecret) {
    return NextResponse.json({ error: "MFA not enrolled" }, { status: 400 })
  }

  let cleared = false
  let usedRecovery = false

  if (body.token && body.token.length === 6) {
    if (verifyTotp(body.token, user.totpSecret)) {
      cleared = true
    }
  } else if (body.recoveryCode && user.recoveryCodesJson) {
    try {
      const hashed = JSON.parse(user.recoveryCodesJson) as string[]
      const remaining = await consumeRecoveryCode(body.recoveryCode, hashed)
      if (remaining !== null) {
        await prisma.fl_StaffUser.update({
          where: { id: user.id },
          data: { recoveryCodesJson: JSON.stringify(remaining) },
        })
        cleared = true
        usedRecovery = true
      }
    } catch {
      // ignore — falls through to the 400 below
    }
  }

  if (!cleared) {
    await writeAudit({
      actorEmail: user.email,
      action: "mfa.challenge.fail",
      outcome: "error",
      detail: { tried: body.token ? "totp" : body.recoveryCode ? "recovery" : "neither" },
    }).catch(() => {})
    return NextResponse.json({ error: "code mismatch" }, { status: 401 })
  }

  // Set the cookie. HTTP-only, secure, SameSite=Lax (browser
  // navigation flow from /mfa-challenge → /).
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
