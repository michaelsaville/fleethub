import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"
import { verifyTotp, consumeRecoveryCode } from "@/lib/mfa"

// Phase 9 WS-B §4.6 — disable MFA. Requires either a current TOTP
// code or a recovery code so a misplaced device can't be exploited
// to silently turn MFA off.

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "mfa.disable" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { token?: string; recoveryCode?: string }

    const user = await prisma.fl_StaffUser.findUnique({
      where: { id },
      select: { id: true, totpSecret: true, totpEnabledAt: true, recoveryCodesJson: true },
    })
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 })
    if (session.role !== "ADMIN" && session.id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (!user.totpEnabledAt) {
      return NextResponse.json({ error: "MFA not enrolled" }, { status: 400 })
    }

    // Prove possession: current TOTP, OR recovery code consumed.
    let proved = false
    if (body.token && user.totpSecret && verifyTotp(body.token, user.totpSecret)) {
      proved = true
    } else if (body.recoveryCode && user.recoveryCodesJson) {
      try {
        const hashed = JSON.parse(user.recoveryCodesJson) as string[]
        const remaining = await consumeRecoveryCode(body.recoveryCode, hashed)
        if (remaining !== null) {
          proved = true
          // Note: we consume even though MFA is being disabled — keeps
          // the recovery-code count honest in the audit row.
        }
      } catch {
        // ignore
      }
    }
    if (!proved) {
      return NextResponse.json(
        { error: "current TOTP code or a recovery code required" },
        { status: 400 },
      )
    }

    await prisma.fl_StaffUser.update({
      where: { id },
      data: {
        totpSecret: null,
        totpEnabledAt: null,
        recoveryCodesJson: null,
      },
    })
    return NextResponse.json({ ok: true })
  },
)
