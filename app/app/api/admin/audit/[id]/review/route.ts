import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"

// Phase 11 WS-E.5 — mark an audit row as reviewed (or flagged).
// Does NOT mutate the chain — only the side metadata columns
// (reviewStatus, reviewedBy, reviewedAt). rowHash + prevHash are
// untouched, so the chain stays intact and verify-chain still
// works.

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "audit.review" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      status?: "reviewed" | "flagged" | "unreviewed"
    }
    const status = body.status ?? "reviewed"
    if (!["reviewed", "flagged", "unreviewed"].includes(status)) {
      return NextResponse.json(
        { error: "status must be reviewed | flagged | unreviewed" },
        { status: 400 },
      )
    }
    const updated = await prisma.fl_AuditLog.update({
      where: { id },
      data: {
        reviewStatus: status,
        reviewedBy: status === "unreviewed" ? null : session.email,
        reviewedAt: status === "unreviewed" ? null : new Date(),
      },
    })
    addAuditDetail(req, {
      auditRowId: id,
      newStatus: status,
      previousAction: updated.action,
    })
    return NextResponse.json({ ok: true, reviewStatus: updated.reviewStatus })
  },
)
