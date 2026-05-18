import { redirect } from "next/navigation"
import { createHash } from "node:crypto"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import RotateWizard from "./RotateWizard"

// Phase 12 WS-C.3 — vault-KEK rotation wizard. 3 steps:
//   1. Pre-flight: count of credentials + current fingerprint via
//      MaskedField + last-rotation date.
//   2. Step-up + typed-confirm via ConfirmModal pattern (handled
//      client-side in RotateWizard).
//   3. Progress polling — initial state shipped server-side, client
//      polls /api/admin/crypto/rotate/[id] every 1s.

export const dynamic = "force-dynamic"

function fingerprint(material: Uint8Array | Buffer): string {
  return createHash("sha256")
    .update(Buffer.from(material))
    .digest("hex")
    .slice(0, 16)
}

export default async function RotatePage({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: string; id?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams
  const purpose = sp.purpose ?? "vault-kek"
  if (purpose !== "vault-kek") {
    redirect("/admin/crypto")
  }
  const [activeKey, totalCreds, inflight] = await Promise.all([
    prisma.fl_CryptoKey.findFirst({
      where: { purpose, retiredAt: null },
      orderBy: { version: "desc" },
    }),
    prisma.fl_Credential.count({ where: { replacedAt: null } }),
    sp.id
      ? prisma.fl_CryptoRotation.findUnique({ where: { id: sp.id } })
      : prisma.fl_CryptoRotation.findFirst({
          where: { state: "in-progress", purpose },
          orderBy: { startedAt: "desc" },
        }),
  ])
  const lastRotation = await prisma.fl_CryptoRotation.findFirst({
    where: { purpose, state: "done" },
    orderBy: { completedAt: "desc" },
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
        <h1 style={TYPOGRAPHY.H1}>Rotate {purpose}</h1>
        <Card>
          <CardHeader title="Pre-flight" />
          <RotateWizard
            purpose={purpose}
            currentVersion={activeKey?.version ?? 0}
            currentFingerprint={activeKey ? fingerprint(activeKey.keyMaterial) : "(none)"}
            totalCredentials={totalCreds}
            lastRotationAt={
              lastRotation?.completedAt ? lastRotation.completedAt.toISOString() : null
            }
            inflight={
              inflight
                ? {
                    id: inflight.id,
                    state: inflight.state,
                    processed: inflight.processed,
                    total: inflight.total,
                    currentTenant: inflight.currentTenant,
                    fromVersion: inflight.fromVersion,
                    toVersion: inflight.toVersion,
                    errorMsg: inflight.errorMsg,
                  }
                : null
            }
          />
        </Card>
      </div>
    </AppShell>
  )
}
