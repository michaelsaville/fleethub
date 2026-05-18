import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"
import { verifyTotp, generateRecoveryCodes } from "@/lib/mfa"

// Phase 9 WS-B §4.6 — finalize MFA enrollment. Operator pastes the
// first 6-digit code from their authenticator; if it verifies, we
// set totpEnabledAt + generate 10 recovery codes (returned ONCE).

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "mfa.enroll.verify" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { token?: string }
    if (!body.token) return NextResponse.json({ error: "token required" }, { status: 400 })

    const user = await prisma.fl_StaffUser.findUnique({
      where: { id },
      select: { id: true, totpSecret: true, totpEnabledAt: true },
    })
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 })
    if (session.role !== "ADMIN" && session.id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (user.totpEnabledAt) {
      return NextResponse.json({ error: "already enrolled" }, { status: 409 })
    }
    if (!user.totpSecret) {
      return NextResponse.json({ error: "no in-progress enrollment — start with POST .../enroll" }, { status: 400 })
    }
    if (!verifyTotp(body.token, user.totpSecret)) {
      return NextResponse.json({ error: "code mismatch — check the time on your authenticator" }, { status: 400 })
    }

    const codes = await generateRecoveryCodes(10)
    await prisma.fl_StaffUser.update({
      where: { id },
      data: {
        totpEnabledAt: new Date(),
        recoveryCodesJson: JSON.stringify(codes.hashed),
      },
    })
    return NextResponse.json({ ok: true, recoveryCodes: codes.plaintext })
  },
)
