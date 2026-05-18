import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import PoliciesClient from "./PoliciesClient"

// Phase 11 WS-D.3 — cross-tenant policy sweep. ADMIN-only.
// Top: tenant-row × policy-column matrix; edit-in-place per cell.
// Bottom: "Apply across N tenants" bulk form. Audit row written
// per tenant by the PATCH route — survives the bulk gesture.

export const dynamic = "force-dynamic"

export default async function PoliciesPage() {
  await requireAdmin()
  const tenants = await prisma.fl_Tenant.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      hipaaMode: true,
      mfaRequired: true,
      bulkApprovalThreshold: true,
      disclosureRequiresApproval: true,
      shellApprovalTagsJson: true,
      backupTriggerEnabled: true,
      remoteControlEnabled: true,
      portalEnabled: true,
      sessionMaxHours: true,
    },
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={TYPOGRAPHY.H1}>Cross-tenant policies</h1>
        <div style={TYPOGRAPHY.HINT}>
          Edit policy fields per tenant, or apply a single policy across many
          tenants at once. Each change writes a per-tenant audit row.
        </div>
        <Card>
          <CardHeader title={`${tenants.length} tenants`} />
          <PoliciesClient
            tenants={tenants.map((t) => ({
              id: t.id,
              name: t.name,
              hipaaMode: t.hipaaMode,
              mfaRequired: t.mfaRequired,
              bulkApprovalThreshold: t.bulkApprovalThreshold,
              disclosureRequiresApproval: t.disclosureRequiresApproval,
              shellApprovalTagsJson: t.shellApprovalTagsJson ?? null,
              backupTriggerEnabled: t.backupTriggerEnabled,
              remoteControlEnabled: t.remoteControlEnabled,
              portalEnabled: t.portalEnabled,
              sessionMaxHours: t.sessionMaxHours,
            }))}
          />
        </Card>
      </div>
    </AppShell>
  )
}
