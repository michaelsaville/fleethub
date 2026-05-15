import "server-only"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"

// Audit-chain hash + walk. Single source of truth — both
// /api/audit/verify and lib/msp-rollup re-use this, so the two
// surfaces can never disagree about whether the chain is intact.
//
// Hash inputs MUST match Fl_AuditLog's writer in lib/audit.ts. If
// either side adds a field to the row contract, all three places
// move together.

export interface AuditChainRow {
  id: string
  prevHash: string | null
  rowHash: string | null
  actorEmail: string | null
  clientName: string | null
  deviceId: string | null
  action: string
  outcome: string
  detailJson: string | null
  createdAt: Date
}

export function hashAuditRow(args: Omit<AuditChainRow, "id" | "rowHash">): string {
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

export interface AuditChainBreak {
  id: string
  index: number
  clientName: string | null
  createdAt: string
  reason: "prevHash mismatch" | "rowHash mismatch"
}

export interface AuditChainResult {
  totalRows: number
  verifiedRows: number
  intact: boolean
  brokenAt: AuditChainBreak | null
  /** Hash of the last verified row — i.e. the chain tip up to the break, or
   *  the absolute tip when intact. Null on an empty chain. */
  hashLast: string | null
  checkedAt: string
}

/**
 * Walk Fl_AuditLog in createdAt order. Returns the same shape the
 * /api/audit/verify route exposes. Identical hashing logic to the
 * row-writer in lib/audit.ts.
 */
export async function verifyAuditChain(): Promise<AuditChainResult> {
  const rows = await prisma.fl_AuditLog.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })

  let prevHash: string | null = null
  let verified = 0
  let brokenAt: AuditChainBreak | null = null

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.prevHash !== prevHash) {
      brokenAt = {
        id: r.id,
        index: i,
        clientName: r.clientName,
        createdAt: r.createdAt.toISOString(),
        reason: "prevHash mismatch",
      }
      break
    }
    const expected = hashAuditRow({
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
        clientName: r.clientName,
        createdAt: r.createdAt.toISOString(),
        reason: "rowHash mismatch",
      }
      break
    }
    verified++
    prevHash = r.rowHash
  }

  return {
    totalRows: rows.length,
    verifiedRows: verified,
    intact: brokenAt === null,
    brokenAt,
    hashLast: prevHash,
    checkedAt: new Date().toISOString(),
  }
}
