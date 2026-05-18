import "server-only"
import { prisma } from "@/lib/prisma"
import { hostname } from "node:os"

// Phase 12 WS-E.5 — cron lease primitive.
//
// Each cron route claims a named lease via INSERT...ON CONFLICT DO
// UPDATE WHERE leasedUntil < now() RETURNING name. 0 rows returned
// = lease held by another runner → skip with 409. Heartbeat extends
// leasedUntil mid-run.
//
// Survives app restart (lease entries are rows, not in-process
// state). Also serves as the cron-stale detector for /api/health
// widening (WS-E.6) — heartbeatAt is the "last seen alive" signal.

const PROC_ID = `${hostname()}#${process.pid}`

export interface LeaseClaim {
  /** Released by the caller in `try { ... } finally` shape. */
  release(): Promise<void>
  /** Extend leasedUntil to now + ttlMs. */
  heartbeat(ttlMs?: number): Promise<void>
  /** The lease handle id (for debugging logs). */
  name: string
}

/** Try to claim a lease named `name` for `ttlMs`. Returns the claim
 *  on success or null when another runner holds it. */
export async function tryAcquireLease(
  name: string,
  ttlMs: number,
): Promise<LeaseClaim | null> {
  const now = new Date()
  const until = new Date(now.getTime() + ttlMs)
  // Postgres UPSERT with conditional update via raw SQL — Prisma's
  // upsert doesn't support a WHERE clause on the conflict path.
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    INSERT INTO fleethub.fl_evaluator_leases ("name", "leasedAt", "leasedUntil", "leasedBy", "heartbeatAt")
    VALUES (${name}, ${now}, ${until}, ${PROC_ID}, ${now})
    ON CONFLICT ("name") DO UPDATE
      SET "leasedAt" = EXCLUDED."leasedAt",
          "leasedUntil" = EXCLUDED."leasedUntil",
          "leasedBy" = EXCLUDED."leasedBy",
          "heartbeatAt" = EXCLUDED."heartbeatAt"
    WHERE fleethub.fl_evaluator_leases."leasedUntil" < ${now}
       OR fleethub.fl_evaluator_leases."leasedBy" = ${PROC_ID}
    RETURNING "name"
  `
  if (rows.length === 0) return null
  return {
    name,
    async release() {
      // Setting leasedUntil to NOW frees the lease for the next
      // runner. We could DELETE the row but keeping it preserves
      // the heartbeatAt timeline for the health endpoint.
      await prisma.fl_EvaluatorLease.updateMany({
        where: { name, leasedBy: PROC_ID },
        data: { leasedUntil: new Date() },
      })
    },
    async heartbeat(ttlMsExtend = ttlMs) {
      const nowB = new Date()
      await prisma.fl_EvaluatorLease.updateMany({
        where: { name, leasedBy: PROC_ID },
        data: {
          leasedUntil: new Date(nowB.getTime() + ttlMsExtend),
          heartbeatAt: nowB,
        },
      })
    },
  }
}

/** Convenience wrapper for cron handlers:
 *   return withLease("name", 90_000, async () => { ... })
 *  Returns the body result OR `null` if another runner is holding
 *  the lease (caller's route should then return a "skipped"
 *  response). */
export async function withLease<T>(
  name: string,
  ttlMs: number,
  body: () => Promise<T>,
): Promise<T | null> {
  const claim = await tryAcquireLease(name, ttlMs)
  if (!claim) return null
  try {
    return await body()
  } finally {
    await claim.release().catch(() => {
      // Release failure is non-fatal — lease will TTL out.
    })
  }
}
