"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import type { DeviceRow } from "@/lib/devices"
import { relativeLastSeen } from "@/lib/devices-time"

/**
 * Client-side table for /devices. Owns:
 *   - search input (debounced URL push)
 *   - row checkbox selection
 *   - sticky bulk-action bar
 *
 * Server passes pre-filtered rows (filter chips already applied via
 * URL params); search narrows further. Sort uses URL too — clicking a
 * column header rewrites `?sort=`.
 */
export default function DeviceTable({ rows }: { rows: DeviceRow[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const initialQ = params.get("q") ?? ""
  const [q, setQ] = useState(initialQ)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Debounced URL push when search changes — keeps server-side filtering
  // authoritative + sharable links.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (q.trim()) next.set("q", q.trim())
      else next.delete("q")
      const nextStr = next.toString()
      const currentStr = params.toString()
      if (nextStr !== currentStr) router.replace(`/devices${nextStr ? `?${nextStr}` : ""}`)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // If the row set changes (filters changed server-side), prune
  // selections that no longer exist.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(rows.map((r) => r.id))
      const next = new Set<string>()
      for (const id of prev) if (ids.has(id)) next.add(id)
      return next
    })
  }, [rows])

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const selectedCount = selected.size

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPage) {
        for (const r of rows) next.delete(r.id)
      } else {
        for (const r of rows) next.add(r.id)
      }
      return next
    })
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sortValue = params.get("sort") ?? "lastSeen"
  function sortHref(target: "hostname" | "lastSeen" | "alerts") {
    const next = new URLSearchParams(params.toString())
    next.set("sort", target)
    return `/devices?${next.toString()}`
  }

  const showEmpty = rows.length === 0
  const onlineCount = useMemo(() => rows.filter((r) => r.isOnline).length, [rows])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search hostname, client, IP, role…"
          style={{
            flex: 1,
            minWidth: "240px",
            padding: "7px 11px",
            fontSize: "12px",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: "6px",
            color: "var(--color-text-primary)",
          }}
        />
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          {rows.length} device{rows.length === 1 ? "" : "s"} · {onlineCount} online
        </span>
      </div>

      {showEmpty ? (
        <div
          style={{
            padding: "40px",
            textAlign: "center",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "10px",
            color: "var(--color-text-muted)",
            fontSize: "13px",
          }}
        >
          No devices match the current filters.
        </div>
      ) : (
        <section
          style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={thRow}>
                <th style={{ ...thStyle, width: "32px", paddingRight: 0 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={allOnPage}
                    onChange={toggleAll}
                    style={{ cursor: "pointer" }}
                  />
                </th>
                <th style={thStyle}>
                  <SortHead label="Host" target="hostname" current={sortValue} href={sortHref("hostname")} />
                </th>
                <th style={thStyle}>Client</th>
                <th style={thStyle}>OS</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>IP</th>
                <th style={thStyle}>
                  <SortHead label="Last seen" target="lastSeen" current={sortValue} href={sortHref("lastSeen")} />
                </th>
                <th style={thStyle}>
                  <SortHead label="Alerts" target="alerts" current={sortValue} href={sortHref("alerts")} />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = selected.has(r.id)
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderTop: "0.5px solid var(--color-border-tertiary)",
                      background: isSel ? "var(--color-background-tertiary)" : undefined,
                    }}
                  >
                    <td style={{ ...tdStyle, paddingRight: 0 }}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.hostname}`}
                        checked={isSel}
                        onChange={() => toggleOne(r.id)}
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <Link
                        href={`/devices/${r.id}`}
                        style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}
                      >
                        <span
                          aria-label={r.isOnline ? "online" : "offline"}
                          title={r.isOnline ? "online" : "offline"}
                          style={{
                            display: "inline-block",
                            width: "7px",
                            height: "7px",
                            borderRadius: "999px",
                            marginRight: "8px",
                            background: r.isOnline ? "var(--color-success)" : "var(--color-text-muted)",
                            verticalAlign: "middle",
                          }}
                        />
                        {r.hostname}
                      </Link>
                    </td>
                    <td style={tdStyle}>
                      <Link
                        href={`/devices?client=${encodeURIComponent(r.clientName)}`}
                        style={{ color: "var(--color-text-secondary)", textDecoration: "none" }}
                      >
                        {r.clientName}
                      </Link>
                    </td>
                    <td style={tdStyle}>
                      <code style={codeStyle}>{r.os ?? "—"}</code>
                      {r.osVersion && (
                        <div style={{ fontSize: "10.5px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                          {shortenOsVersion(r.osVersion)}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>{r.role ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}</td>
                    <td style={{ ...tdStyle, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                      {r.ipAddress ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                    </td>
                    <td style={tdStyle}>
                      {relativeLastSeen(r.lastSeenAt)}
                    </td>
                    <td style={tdStyle}>
                      {r.alertCount > 0 ? (
                        <Link
                          href={`/alerts?deviceId=${r.id}&state=open`}
                          style={alertPillStyle}
                        >
                          {r.alertCount}
                        </Link>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>0</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {selectedCount > 0 && <BulkBar count={selectedCount} onClear={() => setSelected(new Set())} />}
    </div>
  )
}

function SortHead({
  label,
  target,
  current,
  href,
}: {
  label: string
  target: string
  current: string
  href: string
}) {
  const active = current === target
  return (
    <Link href={href} style={{ color: "inherit", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px" }}>
      {label}
      {active && <span aria-hidden style={{ fontSize: "9px" }}>▼</span>}
    </Link>
  )
}

function BulkBar({ count, onClear }: { count: number; onClear: () => void }) {
  // Bulk actions are scaffolded but disabled in Phase 0 — they need
  // matching server actions + agent commands which arrive in later
  // phases. Showing the buttons + the explanatory tooltip is the
  // forcing function: the next phase has visible UI to wire up.
  return (
    <div
      style={{
        position: "sticky",
        bottom: "12px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 14px",
        background: "var(--color-background-tertiary)",
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: "10px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
      }}
    >
      <span style={{ fontSize: "12px", color: "var(--color-text-primary)", fontWeight: 500 }}>
        {count} selected
      </span>
      <span style={{ flex: 1 }} />
      <BulkAction label="Run script" phase="Phase 2" />
      <BulkAction label="Deploy patches" phase="Phase 4" />
      <BulkAction label="Install software" phase="Phase 3" />
      <BulkAction label="Reboot" phase="Phase 2" />
      <button
        onClick={onClear}
        style={{
          fontSize: "11px",
          padding: "5px 10px",
          borderRadius: "5px",
          border: "0.5px solid var(--color-border-secondary)",
          background: "transparent",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        Clear
      </button>
    </div>
  )
}

function BulkAction({ label, phase }: { label: string; phase: string }) {
  return (
    <button
      type="button"
      disabled
      title={`${label} ships in ${phase}`}
      style={{
        fontSize: "11px",
        padding: "5px 10px",
        borderRadius: "5px",
        border: "0.5px solid var(--color-border-tertiary)",
        background: "transparent",
        color: "var(--color-text-muted)",
        cursor: "not-allowed",
      }}
    >
      {label}
    </button>
  )
}

function shortenOsVersion(v: string): string {
  // "Windows 11 Pro 23H2 (10.0.22631.4317)" → "11 Pro 23H2"
  const m = v.match(/Windows\s+(.+?)\s*\(/)
  if (m) return m[1]
  // "Ubuntu Server 22.04.5 LTS" → "Server 22.04.5 LTS"
  if (v.startsWith("Ubuntu ")) return v.slice(7)
  // "macOS 14.5 (23F79)" → "14.5"
  const mac = v.match(/macOS\s+(\S+)/)
  if (mac) return mac[1]
  return v
}

const thRow: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
}
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontWeight: 600,
}
const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
}
const codeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "11px",
  padding: "1px 6px",
  background: "var(--color-background-tertiary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "4px",
  color: "var(--color-text-secondary)",
}
const alertPillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 600,
  background: "var(--color-warning-soft, rgba(234, 179, 8, 0.15))",
  color: "var(--color-warning)",
  textDecoration: "none",
}
