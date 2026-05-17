import AppShell from "@/components/AppShell"
import Link from "next/link"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import MonitorForm, { type MetricOption } from "../MonitorForm"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 3 — new-monitor wizard page. Admin-only;
// the validator + INSERT live in /api/admin/monitors. Metric catalog
// is the v1 perf-only set (mirrors SUPPORTED_METRICS in the evaluator).
// When inv.* / posture.* metrics land in WS-B they get added here +
// in the evaluator's METRIC_RESOLVERS in the same change.

const METRICS: MetricOption[] = [
  {
    id: "perf.cpu.avg",
    label: "CPU average %",
    hint: "Rolling 1-hour average across all cores.",
    unit: "%",
  },
  {
    id: "perf.cpu.p95",
    label: "CPU p95 %",
    hint: "95th percentile of 1-hour samples — catches sustained spikes the average smooths over.",
    unit: "%",
  },
  {
    id: "perf.ram.avg",
    label: "RAM average %",
    hint: "Rolling 1-hour average memory usage.",
    unit: "%",
  },
  {
    id: "perf.ram.p95",
    label: "RAM p95 %",
    hint: "95th percentile memory usage over the window.",
    unit: "%",
  },
  {
    id: "perf.disk.percent",
    label: "Disk used %",
    hint: "System drive percent used at last sample.",
    unit: "%",
  },
]

export default async function NewMonitorPage() {
  await requireAdmin()

  const tenants = await loadTenantOptions()

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
        <header>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            <Link href="/monitors" style={{ color: "inherit", textDecoration: "none" }}>← Monitors</Link>
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            New monitor
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Bind a telemetry threshold to an alert. Fired alerts flow through
            the existing routing, escalation, and runbook pipelines as if
            they came from the agent.
          </p>
        </header>
        <MonitorForm metrics={METRICS} tenants={tenants} />
      </div>
    </AppShell>
  )
}

async function loadTenantOptions(): Promise<string[]> {
  // Same shape /setup/alert-routing/new uses — union of Fl_Tenant
  // rows and active Fl_Device clientNames so newly-enrolled clients
  // without an Fl_Tenant row yet are still pickable.
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
