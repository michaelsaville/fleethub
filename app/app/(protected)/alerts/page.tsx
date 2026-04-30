import Link from "next/link"
import AppShell from "@/components/AppShell"
import AlertsTable from "@/components/AlertsTable"
import SeedBanner from "@/components/SeedBanner"
import { listAlerts } from "@/lib/alerts"
import type { AlertSeverity, AlertState } from "@/lib/alerts"
import { getSessionContext } from "@/lib/authz"

export const dynamic = "force-dynamic"

const SEVERITIES = ["critical", "warn", "info"] as const
const STATES = ["open", "ack", "resolved"] as const

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{
    severity?: string
    state?: string
    client?: string
    deviceId?: string
    q?: string
  }>
}) {
  const sp = await searchParams
  const filters = {
    severity: SEVERITIES.includes(sp.severity as (typeof SEVERITIES)[number]) ? (sp.severity as AlertSeverity) : undefined,
    state:    sp.state === "all"
              ? "all" as const
              : STATES.includes(sp.state as (typeof STATES)[number])
                ? (sp.state as AlertState)
                : "open" as const,
    client:   sp.client || undefined,
    deviceId: sp.deviceId || undefined,
    q:        sp.q?.trim() || undefined,
  }

  const ctx = await getSessionContext()
  const isAdmin = ctx?.role === "ADMIN"

  const result = await listAlerts(filters)
  const { rows, totalBeforeFilter, isMock, totals, facets } = result

  return (
    <AppShell openAlertsCount={totals.open}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Alerts
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
              Active and historical alerts across the fleet. Filters and
              the bulk-ack action persist in the URL — copy the link to
              share a saved view.
            </p>
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", textAlign: "right" }}>
            Showing <strong style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{rows.length}</strong> of {totalBeforeFilter}
          </div>
        </header>

        {isMock && <SeedBanner kind="fleet" />}

        <CountStrip totals={totals} filters={filters} />

        <FilterStrip filters={filters} facets={facets} />

        <AlertsTable rows={rows} isMock={isMock} isAdmin={isAdmin} />
      </div>
    </AppShell>
  )
}

function CountStrip({
  totals,
  filters,
}: {
  totals: {
    open: number
    ack: number
    resolved: number
    critical: number
    warn: number
    info: number
  }
  filters: { severity?: string; state?: string }
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: "8px",
      }}
    >
      <CountCard label="Open"          value={totals.open}     href={hrefFor({ ...filters, state: "open" })}         tone={totals.open     > 0 ? "warn"   : "ok"} active={filters.state    === "open"} />
      <CountCard label="Critical"      value={totals.critical} href={hrefFor({ ...filters, severity: "critical" })}  tone={totals.critical > 0 ? "danger" : "ok"} active={filters.severity === "critical"} />
      <CountCard label="Warning"       value={totals.warn}     href={hrefFor({ ...filters, severity: "warn" })}      tone={totals.warn     > 0 ? "warn"   : "ok"} active={filters.severity === "warn"} />
      <CountCard label="Info"          value={totals.info}     href={hrefFor({ ...filters, severity: "info" })}      tone="neutral"                                active={filters.severity === "info"} />
      <CountCard label="Acknowledged"  value={totals.ack}      href={hrefFor({ ...filters, state: "ack" })}          tone="neutral"                                active={filters.state    === "ack"} />
      <CountCard label="Resolved"      value={totals.resolved} href={hrefFor({ ...filters, state: "resolved" })}     tone="ok"                                     active={filters.state    === "resolved"} />
    </section>
  )
}

function CountCard({
  label,
  value,
  href,
  tone,
  active,
}: {
  label: string
  value: number
  href: string
  tone: "ok" | "warn" | "danger" | "neutral"
  active: boolean
}) {
  const valueColor = {
    ok:      "var(--color-success)",
    warn:    "var(--color-warning)",
    danger:  "var(--color-danger)",
    neutral: "var(--color-text-primary)",
  }[tone]
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "10px 12px",
        background: active ? "var(--color-background-tertiary)" : "var(--color-background-secondary)",
        border: active ? "0.5px solid var(--color-accent)" : "0.5px solid var(--color-border-tertiary)",
        borderRadius: "8px",
        textDecoration: "none",
      }}
    >
      <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: "20px", fontWeight: 600, color: valueColor, lineHeight: 1.1, marginTop: "4px" }}>
        {value}
      </div>
    </Link>
  )
}

function FilterStrip({
  filters,
  facets,
}: {
  filters: {
    severity?: AlertSeverity
    state?: AlertState | "all"
    client?: string
    q?: string
  }
  facets: { clients: Array<{ name: string; count: number }> }
}) {
  function withParam(key: "severity" | "state" | "client", value: string | undefined): string {
    const next = new URLSearchParams()
    if (filters.q) next.set("q", filters.q)
    if (filters.severity && key !== "severity") next.set("severity", filters.severity)
    if (filters.state    && key !== "state"    && filters.state !== "all") next.set("state", filters.state)
    if (filters.client   && key !== "client") next.set("client", filters.client)
    if (value !== undefined) next.set(key, value)
    const s = next.toString()
    return `/alerts${s ? `?${s}` : ""}`
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px 14px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
      }}
    >
      <FacetRow label="State">
        <FilterChip label="Any"          href={withParam("state", "all")}      active={filters.state === "all"} />
        <FilterChip label="Open"         href={withParam("state", "open")}     active={filters.state === "open"} />
        <FilterChip label="Acknowledged" href={withParam("state", "ack")}      active={filters.state === "ack"} />
        <FilterChip label="Resolved"     href={withParam("state", "resolved")} active={filters.state === "resolved"} />
      </FacetRow>
      <FacetRow label="Severity">
        <FilterChip label="Any"      href={withParam("severity", undefined)}    active={!filters.severity} />
        <FilterChip label="Critical" href={withParam("severity", "critical")}   active={filters.severity === "critical"} />
        <FilterChip label="Warning"  href={withParam("severity", "warn")}       active={filters.severity === "warn"} />
        <FilterChip label="Info"     href={withParam("severity", "info")}       active={filters.severity === "info"} />
      </FacetRow>
      {facets.clients.length > 1 && (
        <FacetRow label="Client">
          <FilterChip label="Any" href={withParam("client", undefined)} active={!filters.client} />
          {facets.clients.map((c) => (
            <FilterChip
              key={c.name}
              label={`${c.name} · ${c.count}`}
              href={withParam("client", c.name)}
              active={filters.client === c.name}
            />
          ))}
        </FacetRow>
      )}
    </div>
  )
}

function FacetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          width: "62px",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>{children}</div>
    </div>
  )
}

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        padding: "3px 9px",
        fontSize: "11px",
        borderRadius: "999px",
        textDecoration: "none",
        background: active ? "var(--color-accent)" : "var(--color-background-tertiary)",
        color: active ? "white" : "var(--color-text-secondary)",
        border: active ? "0.5px solid var(--color-accent)" : "0.5px solid var(--color-border-tertiary)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  )
}

function hrefFor(filters: { severity?: string; state?: string; client?: string; q?: string }): string {
  const next = new URLSearchParams()
  if (filters.q)        next.set("q", filters.q)
  if (filters.severity) next.set("severity", filters.severity)
  if (filters.state && filters.state !== "all") next.set("state", filters.state)
  if (filters.client)   next.set("client", filters.client)
  const s = next.toString()
  return `/alerts${s ? `?${s}` : ""}`
}
