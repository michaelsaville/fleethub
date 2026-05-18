import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"

// Phase 9 WS-A §3.8 — bulk-approve all KEV closing patches that
// are still `needs-approval`. The /patches?tab=vulnerable surface
// triggers this with a typed-name confirm on the operator side.
//
// Operator workflow today: open each CVE, click into each closing
// patch, click Approve, repeat. KEV is the day-zero entry surface;
// this is the bulk-do verb.

export const dynamic = "force-dynamic"

export const POST = withAudit({ action: "patch.bulkApproveKev" }, async (_req: NextRequest) => {
  const session = await requireAdmin()
  const candidates = await prisma.fl_Patch.findMany({
    where: {
      approvalState: "needs-approval",
      isKev: true,
    },
    select: { id: true, sourceId: true },
  })
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, approved: 0, ids: [] })
  }
  const ids = candidates.map((p) => p.id)
  await prisma.fl_Patch.updateMany({
    where: { id: { in: ids } },
    data: {
      approvalState: "approved",
      approvedBy: session.email,
      approvedAt: new Date(),
    },
  })
  return NextResponse.json({
    ok: true,
    approved: candidates.length,
    ids,
    sourceIds: candidates.map((p) => p.sourceId),
  })
})
