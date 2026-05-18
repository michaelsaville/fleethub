import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import NetworkDeviceCreateForm from "./NetworkDeviceCreateForm"

// Phase 12 WS-A.7 — manual add form. Auto-discover via SNMP walk
// is intentionally Phase 14+ idea per ROADMAP non-goals.

export const dynamic = "force-dynamic"

export default async function NewNetworkDevicePage() {
  await requireAdmin()
  const [tenants, snmpCreds] = await Promise.all([
    prisma.fl_Tenant.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    prisma.fl_Credential.findMany({
      where: { kind: "snmp-v3", replacedAt: null },
      orderBy: [{ tenantName: "asc" }, { label: "asc" }],
      select: { id: true, tenantName: true, label: true },
    }),
  ])

  return (
    <AppShell>
      <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={TYPOGRAPHY.H1}>New network device</h1>
        <Card>
          <CardHeader title="Device" />
          <NetworkDeviceCreateForm
            tenants={tenants.map((t) => t.name)}
            snmpCreds={snmpCreds.map((c) => ({
              id: c.id,
              tenantName: c.tenantName,
              label: c.label,
            }))}
          />
        </Card>
      </div>
    </AppShell>
  )
}
