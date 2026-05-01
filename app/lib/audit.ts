import "server-only"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"

/**
 * Append-only, hash-chained audit log writer. Per HIPAA-READY.md, every
 * privileged action must produce one row; the chain makes tampering
 * detectable. Never call prisma.fl_AuditLog.create directly — go through
 * here so the chain stays continuous.
 *
 * Phase 1 should add a /api/audit/verify endpoint that walks the chain.
 */

interface WriteAuditArgs {
  actorEmail?: string | null
  clientName?: string | null
  deviceId?: string | null
  action: string
  outcome: "ok" | "error" | "pending"
  detail?: unknown
}

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

export async function writeAudit(args: WriteAuditArgs) {
  return prisma.$transaction(async (tx) => {
    // Serialize audit-chain writers. Without this, two concurrent
    // callers can read the same `prevHash`, both insert a row chained
    // to it, and the verify endpoint reports a chain break. The lock
    // is transaction-scoped (released on COMMIT/ROLLBACK); the
    // read-then-insert is sub-millisecond, so this doesn't become a
    // fleet-scale bottleneck. Constant id 8675309 is shared by any
    // future writer that participates in this chain.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8675309)`

    const last = await tx.fl_AuditLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { rowHash: true },
    })

    const createdAt = new Date()
    const detailJson = args.detail === undefined ? null : JSON.stringify(args.detail)
    const rowHash = hashRow({
      prevHash: last?.rowHash ?? null,
      actorEmail: args.actorEmail ?? null,
      clientName: args.clientName ?? null,
      deviceId: args.deviceId ?? null,
      action: args.action,
      outcome: args.outcome,
      detailJson,
      createdAt,
    })

    return tx.fl_AuditLog.create({
      data: {
        actorEmail: args.actorEmail ?? null,
        clientName: args.clientName ?? null,
        deviceId: args.deviceId ?? null,
        action: args.action,
        outcome: args.outcome,
        detailJson,
        prevHash: last?.rowHash ?? null,
        rowHash,
        createdAt,
      },
    })
  })
}
