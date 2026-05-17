import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import AlertRouteForm from "../AlertRouteForm"

export const dynamic = "force-dynamic"

// Cmd-K pre-fill (WS-D 6.3): `route <severity> <kind-glob> [client]`
// emits a deep-link to this page with severity/kindLike/tenantName in
// the query string. We accept those + thread them through to the form.
const VALID_SEVERITIES = new Set(["critical", "warn", "info"])

export default async function NewAlertRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; kindLike?: string; tenantName?: string }>
}) {
  await requireAdmin()
  const sp = await searchParams
  const [tenantOptions, oncallOptions] = await Promise.all([
    loadTenantOptions(),
    loadOncallOptions(),
  ])

  const prefillSeverity: ("critical" | "warn" | "info")[] = sp.severity && VALID_SEVERITIES.has(sp.severity)
    ? [sp.severity as "critical" | "warn" | "info"]
    : []
  // Only honor tenantName when it's already a known tenant — silent
  // miss is preferable to writing a bogus FK-ish value into the form.
  const prefillTenant = sp.tenantName && tenantOptions.includes(sp.tenantName) ? sp.tenantName : null

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: 760 }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            New alert route
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Decide where alerts go when they fire. Routes are evaluated in
            priority order; first match wins.
          </p>
        </header>
        <AlertRouteForm
          initial={{
            id: null,
            tenantName: prefillTenant,
            severity: prefillSeverity,
            kindLike: sp.kindLike ?? "",
            channels: [],
            escalation: [],
            dedupWindowMin: 15,
            priority: 100,
            isActive: true,
          }}
          tenantOptions={tenantOptions}
          oncallOptions={oncallOptions}
        />
      </div>
    </AppShell>
  )
}

async function loadOncallOptions() {
  const rows = await prisma.fl_OncallSchedule.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })
  return rows
}

async function loadTenantOptions(): Promise<string[]> {
  const [tenants, devClients] = await Promise.all([
    prisma.fl_Tenant.findMany({ select: { name: true } }),
    prisma.fl_Device.findMany({
      where: { isActive: true },
      distinct: ["clientName"],
      select: { clientName: true },
    }),
  ])
  const names = new Set<string>()
  for (const t of tenants) names.add(t.name)
  for (const d of devClients) names.add(d.clientName)
  return [...names].sort((a, b) => a.localeCompare(b))
}
