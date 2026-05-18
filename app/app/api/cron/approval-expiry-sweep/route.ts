import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/with-cron-auth"
import { writeAudit } from "@/lib/audit"

// Phase 12 WS-C.5 — approval & step-up expiry sweep.
//
// Cadence: hourly. Two jobs:
//   1. Fl_ActionApproval state='pending' AND expiresAt < now → flip
//      to 'expired'. Audit row approval.expired per id.
//   2. Fl_StepUpConsumed expMs < now (epoch ms) → DELETE. No audit;
//      this is just a replay-guard ledger, deletion is housekeeping.

export const dynamic = "force-dynamic"

export const POST = withCronAuth(async (_req: NextRequest) => {
  const now = new Date()
  // 1. Expire pending approvals.
  const expiring = await prisma.fl_ActionApproval.findMany({
    where: { state: "pending", expiresAt: { lt: now } },
    select: { id: true, tenantName: true, action: true, requestedBy: true },
  })
  const expireResult = await prisma.fl_ActionApproval.updateMany({
    where: { state: "pending", expiresAt: { lt: now } },
    data: { state: "expired" },
  })
  for (const row of expiring) {
    await writeAudit({
      clientName: row.tenantName,
      actorEmail: row.requestedBy,
      action: "approval.expired",
      outcome: "error",
      detail: { approvalId: row.id, gatedAction: row.action },
    }).catch(() => {})
  }

  // 2. Purge old step-up jti ledger rows.
  const nowMs = BigInt(now.getTime())
  const purgeResult = await prisma.fl_StepUpConsumed.deleteMany({
    where: { expMs: { lt: nowMs } },
  })

  return NextResponse.json({
    ok: true,
    approvalsExpired: expireResult.count,
    stepUpPurged: purgeResult.count,
  })
})
