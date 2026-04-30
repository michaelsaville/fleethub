import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { createHash } from "node:crypto"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * Walk Fl_AuditLog in createdAt order, recompute each rowHash, and report
 * the first break. Per HIPAA-READY.md the chain is the tamper-evidence
 * mechanism; an honest "verify" command that techs can run on demand is
 * the operational counterpart.
 *
 * ADMIN-only — VIEWER and TECH should not be able to enumerate the audit
 * stream even via this minimal projection.
 */

function hashRow(args: {
  prevHash: string | null
  actorEmail: string | null
  clientName: string | null
  deviceId: string | null
  action: string
  outcome: string
  detailJson: string | null
  createdAt: Date
}): string {
  const canonical = [
    args.prevHash ?? "",
    args.actorEmail ?? "",
    args.clientName ?? "",
    args.deviceId ?? "",
    args.action,
    args.outcome,
    args.detailJson ?? "",
    args.createdAt.toISOString(),
  ].join("|")
  return createHash("sha256").update(canonical).digest("hex")
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const rows = await prisma.fl_AuditLog.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })

  let prevHash: string | null = null
  let verified = 0
  let brokenAt: { id: string; index: number; createdAt: string; reason: string } | null = null

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.prevHash !== prevHash) {
      brokenAt = {
        id: r.id,
        index: i,
        createdAt: r.createdAt.toISOString(),
        reason: "prevHash mismatch",
      }
      break
    }
    const expected = hashRow({
      prevHash,
      actorEmail: r.actorEmail,
      clientName: r.clientName,
      deviceId: r.deviceId,
      action: r.action,
      outcome: r.outcome,
      detailJson: r.detailJson,
      createdAt: r.createdAt,
    })
    if (expected !== r.rowHash) {
      brokenAt = {
        id: r.id,
        index: i,
        createdAt: r.createdAt.toISOString(),
        reason: "rowHash mismatch",
      }
      break
    }
    verified++
    prevHash = r.rowHash
  }

  return NextResponse.json({
    totalRows: rows.length,
    verifiedRows: verified,
    intact: brokenAt === null,
    brokenAt,
    hashLast: prevHash,
    checkedAt: new Date().toISOString(),
  })
}
