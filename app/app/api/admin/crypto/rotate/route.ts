import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { consumeStepUp } from "@/lib/step-up"
import { createKey, invalidateKeyCache } from "@/lib/crypto-key"
import { rewrapTenantCredentials } from "@/lib/credential-vault"

// Phase 12 WS-C.3 — vault-KEK rotation initiator.
//
// POST /api/admin/crypto/rotate
//   Body: { purpose: "vault-kek" }
//   Headers: X-FleetHub-StepUp (required)
//
// 1. Refuse if a rotation is already in-progress.
// 2. Consume step-up.
// 3. Insert new Fl_CryptoKey row at version+1; retire prior.
// 4. Create Fl_CryptoRotation row with state='in-progress'.
// 5. Kick off rewrapTenantCredentials in a non-awaited Promise.
//    Return { rotationId } immediately so the wizard can poll.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

export const POST = withAudit(
  { action: "crypto.key.rotate-start" },
  async (req: NextRequest) => {
    const session = await requireAdmin()
    if (!session.id) {
      return NextResponse.json({ error: "session lacks user id" }, { status: 500 })
    }
    const stepUp = await consumeStepUp(req, session.id)
    if (!stepUp.ok) {
      return NextResponse.json({ error: stepUp.reason }, { status: stepUp.status })
    }
    const body = (await req.json().catch(() => ({}))) as {
      purpose?: string
    }
    const purpose = body.purpose ?? "vault-kek"
    if (purpose !== "vault-kek") {
      return NextResponse.json(
        { error: "v1 only supports rotating vault-kek" },
        { status: 400 },
      )
    }

    // Refuse concurrent rotation.
    const inflight = await prisma.fl_CryptoRotation.findFirst({
      where: { state: "in-progress", purpose },
    })
    if (inflight) {
      return NextResponse.json(
        { error: `rotation already in-progress (id ${inflight.id})` },
        { status: 409 },
      )
    }

    // Find current active version.
    const prior = await prisma.fl_CryptoKey.findFirst({
      where: { purpose, retiredAt: null },
      orderBy: { version: "desc" },
    })
    if (!prior) {
      return NextResponse.json(
        { error: "no active vault-kek to rotate from; run bootstrap-crypto-keys.ts first" },
        { status: 400 },
      )
    }

    // Count credentials about to be rewrapped (UI feedback).
    const total = await prisma.fl_Credential.count({
      where: { replacedAt: null, keyVersion: prior.version },
    })

    // Create the new key. createKey() will retire the prior + invalidate cache.
    const newKey = await createKey(purpose, session.email, `Rotated by ${session.email}`)
    invalidateKeyCache(purpose)

    // Record the rotation state row.
    const rot = await prisma.fl_CryptoRotation.create({
      data: {
        purpose,
        fromVersion: prior.version,
        toVersion: newKey.version,
        state: "in-progress",
        total,
        initiatedBy: session.email,
      },
    })
    addAuditDetail(req, {
      rotationId: rot.id,
      fromVersion: prior.version,
      toVersion: newKey.version,
      totalCredentials: total,
    })

    // Fire the rewrap loop without awaiting — the route returns
    // immediately and the wizard polls Fl_CryptoRotation by id.
    // The Promise has its own error handler that flips state to
    // 'failed' on uncaught throws.
    void runRewrapInBackground({
      rotationId: rot.id,
      fromVersion: prior.version,
      toVersion: newKey.version,
    })

    return NextResponse.json(
      { rotationId: rot.id, fromVersion: prior.version, toVersion: newKey.version, total },
      { status: 202 },
    )
  },
)

async function runRewrapInBackground(args: {
  rotationId: string
  fromVersion: number
  toVersion: number
}) {
  try {
    await rewrapTenantCredentials({
      fromVersion: args.fromVersion,
      toVersion: args.toVersion,
      onProgress: async (p) => {
        await prisma.fl_CryptoRotation
          .update({
            where: { id: args.rotationId },
            data: {
              processed: p.processed,
              total: p.total,
              currentTenant: p.currentTenant,
            },
          })
          .catch(() => {
            // Progress write failure must not break the loop.
          })
      },
    })
    await prisma.fl_CryptoRotation.update({
      where: { id: args.rotationId },
      data: { state: "done", completedAt: new Date() },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[crypto.rotate] rewrap failed", err)
    await prisma.fl_CryptoRotation
      .update({
        where: { id: args.rotationId },
        data: { state: "failed", completedAt: new Date(), errorMsg: msg },
      })
      .catch(() => {})
  }
}
