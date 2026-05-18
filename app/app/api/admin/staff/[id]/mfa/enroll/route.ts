import { NextRequest, NextResponse } from "next/server"
import qrcode from "qrcode"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"
import { generateSecret, otpauthUrl } from "@/lib/mfa"

// Phase 9 WS-B §4.6 — MFA enrollment kickoff. Returns the new
// secret + QR data URL. Caller's next POST hits /verify with a
// 6-digit code to confirm; that's when totpEnabledAt is set.

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "mfa.enroll.start" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession()
    const { id } = await params

    // ADMIN can enroll any user; non-admin can only enroll themselves.
    const user = await prisma.fl_StaffUser.findUnique({
      where: { id },
      select: { id: true, email: true, totpEnabledAt: true, role: true },
    })
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 })
    if (session.role !== "ADMIN" && session.id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (user.totpEnabledAt) {
      return NextResponse.json({ error: "already enrolled — disable first to re-enroll" }, { status: 409 })
    }

    const secret = generateSecret()
    // Stash the in-progress secret so /verify can confirm against it.
    // Until the verify step succeeds, totpEnabledAt stays null and
    // login flow ignores this user's MFA state.
    await prisma.fl_StaffUser.update({
      where: { id },
      data: { totpSecret: secret },
    })

    const uri = otpauthUrl(user.email, secret)
    const qrDataUrl = await qrcode.toDataURL(uri, { margin: 1, width: 220 })
    return NextResponse.json({ secret, qrDataUrl, otpauthUrl: uri })
  },
)
