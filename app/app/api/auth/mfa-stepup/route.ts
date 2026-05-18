import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { verifyTotp } from "@/lib/mfa"
import { mintStepUpToken } from "@/lib/crypto-key"
import { writeAudit } from "@/lib/audit"

// Phase 11 WS-C.5 — TOTP step-up. Alternative to WebAuthn step-up
// for users who don't have a passkey enrolled yet. Verifies a fresh
// TOTP code, returns a step-up token usable on disclose + approve
// verbs for 5 minutes / one use.
//
// Unlike /api/auth/mfa-verify (login gate), this does NOT set the
// mfa-cookie — step-up is per-action, not per-session.

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

  const body = (await req.json().catch(() => ({}))) as { code?: string }
  const code = (body.code ?? "").trim()
  if (!code || code.length !== 6) {
    return NextResponse.json(
      { error: "6-digit code required" },
      { status: 400 },
    )
  }

  const user = await prisma.fl_StaffUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpSecret: true, totpEnabledAt: true },
  })
  if (!user || !user.totpEnabledAt || !user.totpSecret) {
    return NextResponse.json(
      { error: "MFA not enrolled — cannot step up via TOTP" },
      { status: 400 },
    )
  }

  if (!verifyTotp(code, user.totpSecret)) {
    await writeAudit({
      actorEmail: user.email,
      action: "mfa.stepup.fail",
      outcome: "error",
      detail: { method: "totp" },
    }).catch(() => {})
    return NextResponse.json({ error: "code mismatch" }, { status: 401 })
  }

  const stepUpToken = await mintStepUpToken(user.id)
  await writeAudit({
    actorEmail: user.email,
    action: "mfa.stepup.ok",
    outcome: "ok",
    detail: { method: "totp" },
  }).catch(() => {})
  return NextResponse.json({ ok: true, stepUpToken })
}
