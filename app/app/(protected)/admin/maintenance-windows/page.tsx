import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { EmptyState } from "@/components/ui/EmptyState"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import MaintenanceWindowsClient from "./MaintenanceWindowsClient"

// Phase 12 WS-B — cross-tenant maintenance windows admin.
// ADMIN-only. Per-tenant access via TenantSettingsTab links here too.

export const dynamic = "force-dynamic"

export default async function MaintenanceWindowsPage() {
  await requireAdmin()
  const [windows, tenants] = await Promise.all([
    prisma.fl_MaintenanceWindow.findMany({
      where: { isActive: true },
      orderBy: [{ tenantName: "asc" }, { name: "asc" }],
    }),
    prisma.fl_Tenant.findMany({
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ])
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={TYPOGRAPHY.H1}>Maintenance windows</h1>
        <div style={TYPOGRAPHY.HINT}>
          Recurring windows during which alert kinds are suppressed and
          targeted devices are flipped to maintenance mode. Cron syntax
          is standard 5-field (minute hour dom mon dow). Reuses
          Fl_Device.maintenanceMode plumbing — same operator-visible
          state as the manual toggle on /devices/[id].
        </div>
        <Card>
          <CardHeader title={`${windows.length} active windows`} />
          {windows.length === 0 && (
            <EmptyState
              title="No windows configured"
              body="Add a window for recurring patch cycles, vendor maintenance, or scheduled reboots."
            />
          )}
          <MaintenanceWindowsClient
            tenants={tenants.map((t) => t.name)}
            initialWindows={windows.map((w) => ({
              id: w.id,
              tenantName: w.tenantName,
              name: w.name,
              cron: w.cron,
              durationMin: w.durationMin,
              suppressAlertKindsJson: w.suppressAlertKindsJson ?? null,
              scopeJson: w.scopeJson ?? null,
              nextStart: w.nextStart ? w.nextStart.toISOString() : null,
              nextEnd: w.nextEnd ? w.nextEnd.toISOString() : null,
              lastFiredAt: w.lastFiredAt ? w.lastFiredAt.toISOString() : null,
            }))}
          />
        </Card>
      </div>
    </AppShell>
  )
}
