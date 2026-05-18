"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import type { ViewFilters } from "@/lib/device-view-types"

/**
 * In-page filter-chip strip for /devices. Mirrors TicketHub's
 * TicketFilters pattern: takes the merged effective filters as a
 * prop, pushes URL overlay params on change. The page rebuilds
 * `effectiveFilters = view.filters + URL overrides` on every render
 * so the chips always reflect what's actually applied.
 *
 * Chips are FleetHub-flavored:
 *   OS         windows / linux / darwin   multi-select array param
 *   Online     online | offline           single tristate
 *   Role       <facet roles> chips         multi-select array param
 *   Alerts     hasAlerts true/false        boolean
 *   Maint      on | off                    single tristate
 *   Enrolled   yes | no                    single tristate
 *   Client     dropdown                    single
 *
 * Clear-all wipes every overlay param and falls back to the active
 * view's filters.
 */
export default function DeviceFilters({
  filters,
  facets,
}: {
  filters: ViewFilters
  facets: {
    clients: Array<{ name: string; count: number }>
    osCounts: { windows: number; linux: number; darwin: number }
    onlineCounts: { online: number; offline: number }
    roles: Array<{ name: string; count: number }>
  }
}) {
  const router = useRouter()
  const params = useSearchParams()
  // Local q + debounce so each keystroke doesn't push a URL update.
  const [q, setQ] = useState(filters.q ?? "")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setQ(filters.q ?? "")
  }, [filters.q])
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (q.trim() === (filters.q ?? "")) return
      pushOverlay({ q: q.trim() || null })
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function pushOverlay(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k)
      else next.set(k, v)
    }
    router.push(`/devices${next.toString() ? `?${next}` : ""}`)
  }

  function toggleArrayParam(
    key: "os" | "role",
    value: string,
    current: readonly string[] | undefined,
  ) {
    const set = new Set(current ?? [])
    if (set.has(value)) set.delete(value)
    else set.add(value)
    pushOverlay({ [key]: set.size > 0 ? [...set].join(",") : null })
  }

  function setSingle(key: string, value: string | null) {
    pushOverlay({ [key]: value })
  }

  function clearAll() {
    const next = new URLSearchParams(params.toString())
    for (const key of ["q", "client", "os", "online", "role", "hasAlerts", "maintenance", "enrolled", "sort", "sortField", "sortDir"]) {
      next.delete(key)
    }
    setQ("")
    router.push(`/devices${next.toString() ? `?${next}` : ""}`)
  }

  const osSelected = new Set(filters.os ?? [])
  const roleSelected = new Set(filters.role ?? [])
  const onlineSel = filters.online
  const alertsSel = filters.hasAlerts
  const maintSel = filters.maintenance
  const enrolledSel = filters.enrolled
  const clientSel = filters.client ?? ""

  const hasAny =
    (filters.q && filters.q.length > 0) ||
    osSelected.size > 0 ||
    roleSelected.size > 0 ||
    onlineSel !== undefined ||
    alertsSel !== undefined ||
    maintSel !== undefined ||
    enrolledSel !== undefined ||
    clientSel !== ""

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={rowStyle}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search friendly name, hostname, client, IP, role…"
          style={inputStyle}
        />
        {hasAny && (
          <button type="button" onClick={clearAll} style={clearBtnStyle}>
            Clear filters
          </button>
        )}
      </div>

      <div style={rowStyle}>
        <FacetLabel>OS</FacetLabel>
        <Chip
          label={`Win · ${facets.osCounts.windows}`}
          active={osSelected.has("windows")}
          onClick={() => toggleArrayParam("os", "windows", filters.os)}
        />
        <Chip
          label={`Linux · ${facets.osCounts.linux}`}
          active={osSelected.has("linux")}
          onClick={() => toggleArrayParam("os", "linux", filters.os)}
        />
        <Chip
          label={`macOS · ${facets.osCounts.darwin}`}
          active={osSelected.has("darwin")}
          onClick={() => toggleArrayParam("os", "darwin", filters.os)}
        />

        <FacetLabel>Online</FacetLabel>
        <Chip
          label={`Online · ${facets.onlineCounts.online}`}
          active={onlineSel === "online"}
          onClick={() => setSingle("online", onlineSel === "online" ? null : "online")}
        />
        <Chip
          label={`Offline · ${facets.onlineCounts.offline}`}
          active={onlineSel === "offline"}
          onClick={() => setSingle("online", onlineSel === "offline" ? null : "offline")}
        />

        <FacetLabel>Alerts</FacetLabel>
        <Chip
          label="Has alerts"
          active={alertsSel === true}
          onClick={() => setSingle("hasAlerts", alertsSel === true ? null : "true")}
        />
        <Chip
          label="No alerts"
          active={alertsSel === false}
          onClick={() => setSingle("hasAlerts", alertsSel === false ? null : "false")}
        />

        <FacetLabel>Maint</FacetLabel>
        <Chip
          label="On"
          active={maintSel === "on"}
          onClick={() => setSingle("maintenance", maintSel === "on" ? null : "on")}
        />
        <Chip
          label="Off"
          active={maintSel === "off"}
          onClick={() => setSingle("maintenance", maintSel === "off" ? null : "off")}
        />

        <FacetLabel>Agent</FacetLabel>
        <Chip
          label="Enrolled"
          active={enrolledSel === "yes"}
          onClick={() => setSingle("enrolled", enrolledSel === "yes" ? null : "yes")}
        />
        <Chip
          label="Not enrolled"
          active={enrolledSel === "no"}
          onClick={() => setSingle("enrolled", enrolledSel === "no" ? null : "no")}
        />
      </div>

      {facets.roles.length > 0 && (
        <div style={rowStyle}>
          <FacetLabel>Role</FacetLabel>
          {facets.roles.map((r) => (
            <Chip
              key={r.name}
              label={`${r.name} · ${r.count}`}
              active={roleSelected.has(r.name)}
              onClick={() => toggleArrayParam("role", r.name, filters.role)}
            />
          ))}
        </div>
      )}

      {facets.clients.length > 1 && (
        <div style={rowStyle}>
          <FacetLabel>Client</FacetLabel>
          <select
            value={clientSel}
            onChange={(e) => setSingle("client", e.target.value || null)}
            style={selectStyle}
          >
            <option value="">All clients</option>
            {facets.clients.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

function FacetLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--color-text-muted)",
        marginRight: 2,
      }}
    >
      {children}
    </span>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...chipStyle,
        ...(active ? chipActiveStyle : null),
      }}
    >
      {label}
    </button>
  )
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 240,
  padding: "7px 11px",
  fontSize: 12,
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: 6,
  color: "var(--color-text-primary)",
}

const selectStyle: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 11.5,
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: 5,
  color: "var(--color-text-primary)",
}

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 9px",
  fontSize: 11,
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: 999,
  color: "var(--color-text-secondary)",
  cursor: "pointer",
}

const chipActiveStyle: React.CSSProperties = {
  background: "var(--color-accent)",
  color: "#fff",
  borderColor: "var(--color-accent)",
}

const clearBtnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "5px 10px",
  borderRadius: 5,
  border: "0.5px solid var(--color-border-secondary)",
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
}
