import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import NewReportForm from "./NewReportForm"

export const dynamic = "force-dynamic"

export default async function NewReportPage() {
  // Tenant list: from Fl_Tenant. Falls back to distinct clientName values
  // off Fl_Device when the tenant table hasn't been seeded yet.
  const [tenants, distinctClients] = await Promise.all([
    prisma.fl_Tenant.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.fl_Device.findMany({ select: { clientName: true }, distinct: ["clientName"] }),
  ])
  const tenantNames =
    tenants.length > 0
      ? tenants.map((t) => t.name)
      : distinctClients.map((c) => c.clientName).filter(Boolean).sort()

  return (
    <AppShell>
      <div style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: 16 }}>
        <header>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
            <a href="/reports" style={{ color: "inherit", textDecoration: "none" }}>← Reports</a>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4, letterSpacing: "-0.01em" }}>
            Generate report
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0 }}>
            Pick a tenant + report kind. The PDF renders inline (~2 seconds)
            and lands at /reports/[id] when ready.
          </p>
        </header>
        <NewReportForm tenants={tenantNames} />
      </div>
    </AppShell>
  )
}
