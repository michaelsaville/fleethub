import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { verifyAuditChain } from "@/lib/audit-chain"

export const dynamic = "force-dynamic"

/**
 * Walk Fl_AuditLog, recompute each rowHash, report the first break.
 * Per HIPAA-READY.md the chain is the tamper-evidence mechanism; an
 * honest "verify" command techs can run on demand is the operational
 * counterpart. Hash + walk logic lives in lib/audit-chain so the
 * Phase 6 MSP-rollup re-uses it without drift.
 *
 * ADMIN-only — VIEWER and TECH should not be able to enumerate the
 * audit stream even via this minimal projection.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const result = await verifyAuditChain()
  // Preserve the original response shape — pre-refactor brokenAt did
  // not include clientName. Strip it so callers don't break.
  const { brokenAt, ...rest } = result
  return NextResponse.json({
    ...rest,
    brokenAt: brokenAt
      ? {
          id: brokenAt.id,
          index: brokenAt.index,
          createdAt: brokenAt.createdAt,
          reason: brokenAt.reason,
        }
      : null,
  })
}
