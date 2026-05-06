import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import ScheduledReportsClient from "./ScheduledReportsClient"

export const dynamic = "force-dynamic"

export default async function ScheduledReportsPage() {
  const [schedules, tenants, distinctClients] = await Promise.all([
    prisma.fl_ReportSchedule.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.fl_Tenant.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.fl_Device.findMany({ select: { clientName: true }, distinct: ["clientName"] }),
  ])
  const tenantNames =
    tenants.length > 0
      ? tenants.map((t) => t.name)
      : distinctClients.map((c) => c.clientName).filter(Boolean).sort()

  return (
    <AppShell>
      <div style={{ maxWidth: 1100, display: "flex", flexDirection: "column", gap: 16 }}>
        <header>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
            <a href="/reports" style={{ color: "inherit", textDecoration: "none" }}>← Reports</a>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4, letterSpacing: "-0.01em" }}>
            Scheduled reports
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0 }}>
            Recurring report deliveries. Each schedule fires per its cron
            expression and emails the rendered PDF to the listed recipients.
            Edit a schedule by deleting it and creating a fresh one.
          </p>
        </header>
        <ScheduledReportsClient
          tenants={tenantNames}
          initialSchedules={schedules.map((s) => ({
            id: s.id,
            tenantName: s.tenantName,
            kind: s.kind,
            audience: s.audience,
            cron: s.cron,
            timezone: s.timezone,
            dateRange: s.dateRange,
            deliveryJson: s.deliveryJson,
            isActive: s.isActive,
            lastFiredAt: s.lastFiredAt ? s.lastFiredAt.toISOString() : null,
            lastErrorAt: s.lastErrorAt ? s.lastErrorAt.toISOString() : null,
            lastError: s.lastError,
            createdBy: s.createdBy,
            createdAt: s.createdAt.toISOString(),
          }))}
        />
      </div>
    </AppShell>
  )
}
