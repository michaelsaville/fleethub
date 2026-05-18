import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"
import { verifyTotp, generateRecoveryCodes } from "@/lib/mfa"

// Phase 11 WS-C.7 — regenerate the 10 recovery codes. Requires a
// fresh TOTP code (operator proves possession of the authenticator)
// to prevent a session-hijack from neutering recovery options.
// Returns the new cleartext codes ONCE (same "shown-once" pattern
// as initial enrollment).

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "mfa.recovery.regenerate" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { token?: string }
    if (!body.token || body.token.length !== 6) {
      return NextResponse.json({ error: "fresh 6-digit code required" }, { status: 400 })
    }

    const user = await prisma.fl_StaffUser.findUnique({
      where: { id },
      select: { id: true, totpSecret: true, totpEnabledAt: true },
    })
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 })
    if (session.role !== "ADMIN" && session.id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (!user.totpEnabledAt || !user.totpSecret) {
      return NextResponse.json(
        { error: "MFA not enrolled — cannot regenerate" },
        { status: 400 },
      )
    }
    if (!verifyTotp(body.token, user.totpSecret)) {
      return NextResponse.json({ error: "code mismatch" }, { status: 401 })
    }

    const codes = await generateRecoveryCodes(10)
    await prisma.fl_StaffUser.update({
      where: { id },
      data: { recoveryCodesJson: JSON.stringify(codes.hashed) },
    })
    return NextResponse.json({ ok: true, recoveryCodes: codes.plaintext })
  },
)
