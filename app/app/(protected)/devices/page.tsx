import Link from "next/link"
import AppShell from "@/components/AppShell"
import DeviceTable from "@/components/DeviceTable"
import SeedBanner from "@/components/SeedBanner"
import { listDevices } from "@/lib/devices"

export const dynamic = "force-dynamic"

type RawSearchParams = {
  q?: string
  client?: string
  os?: string
  online?: string
  role?: string
  sort?: string
}

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const sp = await searchParams
  const filters = {
    q: sp.q?.trim() || undefined,
    client: sp.client || undefined,
    os: ["windows", "linux", "darwin"].includes(sp.os ?? "") ? (sp.os as "windows" | "linux" | "darwin") : undefined,
    online: (sp.online === "online" || sp.online === "offline" ? sp.online : undefined) as "online" | "offline" | undefined,
    role: sp.role || undefined,
    sort: ["lastSeen", "hostname", "alerts"].includes(sp.sort ?? "") ? (sp.sort as "lastSeen" | "hostname" | "alerts") : undefined,
  }
  const { rows, totalBeforeFilter, isMock, facets } = await listDevices(filters)

  const filtersActive =
    !!filters.q || !!filters.client || !!filters.os || !!filters.online || !!filters.role

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Devices
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
              Flat fleet-wide list. Filters and sort persist in the URL —
              copy the link to share a saved view.
            </p>
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", textAlign: "right" }}>
            {filtersActive ? (
              <>
                Showing <strong style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{rows.length}</strong> of {totalBeforeFilter}
              </>
            ) : (
              <>
                <strong style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{totalBeforeFilter}</strong> total
              </>
            )}
          </div>
        </header>

        {isMock && <SeedBanner kind="fleet" />}

        <FilterStrip filters={filters} facets={facets} />

        <DeviceTable rows={rows} />
      </div>
    </AppShell>
  )
}

function FilterStrip({
  filters,
  facets,
}: {
  filters: {
    q?: string
    client?: string
    os?: "windows" | "linux" | "darwin"
    online?: "online" | "offline"
    role?: string
    sort?: "lastSeen" | "hostname" | "alerts"
  }
  facets: {
    clients: Array<{ name: string; count: number }>
    osCounts: { windows: number; linux: number; darwin: number }
    onlineCounts: { online: number; offline: number }
    roles: Array<{ name: string; count: number }>
  }
}) {
  const baseParams = new URLSearchParams()
  if (filters.q) baseParams.set("q", filters.q)
  if (filters.sort) baseParams.set("sort", filters.sort)

  function withParam(key: string, value: string | undefined): string {
    const next = new URLSearchParams(baseParams.toString())
    if (filters.client && key !== "client") next.set("client", filters.client)
    if (filters.os && key !== "os") next.set("os", filters.os)
    if (filters.online && key !== "online") next.set("online", filters.online)
    if (filters.role && key !== "role") next.set("role", filters.role)
    if (value === undefined) next.delete(key)
    else next.set(key, value)
    const s = next.toString()
    return `/devices${s ? `?${s}` : ""}`
  }

  const anyFilter = filters.client || filters.os || filters.online || filters.role
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
      <FacetRow label="OS">
        <FilterChip label="Any" href={withParam("os", undefined)} active={!filters.os} />
        <FilterChip label={`Windows · ${facets.osCounts.windows}`} href={withParam("os", "windows")} active={filters.os === "windows"} />
        <FilterChip label={`Linux · ${facets.osCounts.linux}`} href={withParam("os", "linux")} active={filters.os === "linux"} />
        <FilterChip label={`macOS · ${facets.osCounts.darwin}`} href={withParam("os", "darwin")} active={filters.os === "darwin"} />
      </FacetRow>
      <FacetRow label="Online">
        <FilterChip label="Any" href={withParam("online", undefined)} active={!filters.online} />
        <FilterChip
          label={`Online · ${facets.onlineCounts.online}`}
          href={withParam("online", "online")}
          active={filters.online === "online"}
        />
        <FilterChip
          label={`Offline · ${facets.onlineCounts.offline}`}
          href={withParam("online", "offline")}
          active={filters.online === "offline"}
        />
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
      {facets.roles.length > 0 && (
        <FacetRow label="Role">
          <FilterChip label="Any" href={withParam("role", undefined)} active={!filters.role} />
          {facets.roles.map((r) => (
            <FilterChip
              key={r.name}
              label={`${r.name} · ${r.count}`}
              href={withParam("role", r.name)}
              active={filters.role === r.name}
            />
          ))}
        </FacetRow>
      )}
      {anyFilter && (
        <div>
          <Link
            href={`/devices${filters.q ? `?q=${encodeURIComponent(filters.q)}` : ""}`}
            style={{
              fontSize: "11px",
              color: "var(--color-text-secondary)",
              textDecoration: "underline",
            }}
          >
            Reset filters
          </Link>
        </div>
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
          width: "52px",
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
