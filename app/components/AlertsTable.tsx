"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { relativeLastSeen } from "@/lib/devices-time"
import type { AlertRow } from "@/lib/alerts"
import { ackAlert, bulkAckAlerts, resolveAlert } from "@/app/(protected)/alerts/actions"

/**
 * Client-side table for /alerts. Owns search + bulk-select state and
 * fires the row-level + bulk server actions. Mock alerts are rendered
 * with the action buttons disabled — see actions.ts for the rationale.
 */
export default function AlertsTable({
  rows,
  isMock,
  isAdmin,
}: {
  rows: AlertRow[]
  isMock: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [q, setQ] = useState(params.get("q") ?? "")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (q.trim()) next.set("q", q.trim())
      else next.delete("q")
      const nextStr = next.toString()
      if (nextStr !== params.toString()) router.replace(`/alerts${nextStr ? `?${nextStr}` : ""}`)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(rows.map((r) => r.id))
      const next = new Set<string>()
      for (const id of prev) if (ids.has(id)) next.add(id)
      return next
    })
  }, [rows])

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id))
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPage) for (const r of rows) next.delete(r.id)
      else for (const r of rows) next.add(r.id)
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

  const ackable = isAdmin && !isMock
  const selectedOpen = rows.filter((r) => selected.has(r.id) && r.state === "open")

  function onBulkAck() {
    if (!ackable || selectedOpen.length === 0) return
    const fd = new FormData()
    fd.set("ids", selectedOpen.map((r) => r.id).join(","))
    startTransition(async () => {
      await bulkAckAlerts(fd)
      setSelected(new Set())
    })
  }
  function onAck(id: string) {
    if (!ackable) return
    const fd = new FormData()
    fd.set("id", id)
    startTransition(async () => {
      await ackAlert(fd)
    })
  }
  function onResolve(id: string) {
    if (!ackable) return
    const fd = new FormData()
    fd.set("id", id)
    startTransition(async () => {
      await resolveAlert(fd)
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, kind, host, client…"
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
          {rows.length} alert{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length === 0 ? (
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
          No alerts match the current filters.
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
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>Alert</th>
                <th style={thStyle}>Host</th>
                <th style={thStyle}>Client</th>
                <th style={thStyle}>Age</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = selected.has(r.id)
                const sev = severityStyle(r.severity)
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
                        aria-label={`Select ${r.title}`}
                        checked={isSel}
                        onChange={() => toggleOne(r.id)}
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <span
                        title={r.severity}
                        style={{
                          display: "inline-block",
                          width: "8px",
                          height: "8px",
                          borderRadius: "999px",
                          background: sev.color,
                          marginRight: "8px",
                          verticalAlign: "middle",
                        }}
                      />
                      <span style={{ fontSize: "11px", color: sev.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {r.severity}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <Link
                        href={`/alerts/${r.id}`}
                        style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}
                      >
                        {r.title}
                      </Link>
                      <div style={{ fontSize: "10.5px", color: "var(--color-text-muted)", marginTop: "2px", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                        {r.kind}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      {r.deviceId ? (
                        <Link
                          href={`/devices/${r.deviceId}`}
                          style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}
                        >
                          {r.deviceHostname ?? r.deviceId}
                        </Link>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {r.clientName ? (
                        <Link
                          href={`/devices?client=${encodeURIComponent(r.clientName)}`}
                          style={{ color: "var(--color-text-secondary)", textDecoration: "none" }}
                        >
                          {r.clientName}
                        </Link>
                      ) : "—"}
                    </td>
                    <td style={tdStyle}>{relativeLastSeen(r.createdAt)}</td>
                    <td style={tdStyle}>
                      <StatePill state={r.state} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                      {r.state === "open" && (
                        <RowAction
                          label="Ack"
                          onClick={() => onAck(r.id)}
                          disabled={!ackable || pending}
                          tooltip={!isAdmin ? "ADMIN role required" : isMock ? "Seed alert — real ack ships with the agent" : ""}
                        />
                      )}
                      {r.state !== "resolved" && (
                        <RowAction
                          label="Resolve"
                          onClick={() => onResolve(r.id)}
                          disabled={!ackable || pending}
                          tooltip={!isAdmin ? "ADMIN role required" : isMock ? "Seed alert — real resolve ships with the agent" : ""}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          openCount={selectedOpen.length}
          onAck={onBulkAck}
          onClear={() => setSelected(new Set())}
          ackable={ackable}
          isMock={isMock}
          isAdmin={isAdmin}
          pending={pending}
        />
      )}
    </div>
  )
}

function severityStyle(sev: AlertRow["severity"]) {
  if (sev === "critical") return { color: "var(--color-danger)" }
  if (sev === "warn")     return { color: "var(--color-warning)" }
  return { color: "var(--color-text-muted)" }
}

function StatePill({ state }: { state: AlertRow["state"] }) {
  const map = {
    open:     { bg: "var(--color-warning-soft, rgba(234, 179, 8, 0.15))", fg: "var(--color-warning)" },
    ack:      { bg: "var(--color-background-tertiary)",                   fg: "var(--color-text-secondary)" },
    resolved: { bg: "var(--color-success-soft, rgba(34, 197, 94, 0.15))", fg: "var(--color-success)" },
  }[state] ?? { bg: "var(--color-background-tertiary)", fg: "var(--color-text-muted)" }
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: "999px",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        background: map.bg,
        color: map.fg,
      }}
    >
      {state}
    </span>
  )
}

function RowAction({
  label,
  onClick,
  disabled,
  tooltip,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  tooltip: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip || undefined}
      style={{
        marginLeft: "6px",
        fontSize: "11px",
        padding: "3px 9px",
        borderRadius: "5px",
        border: "0.5px solid var(--color-border-secondary)",
        background: "transparent",
        color: disabled ? "var(--color-text-muted)" : "var(--color-text-primary)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  )
}

function BulkBar({
  count,
  openCount,
  onAck,
  onClear,
  ackable,
  isMock,
  isAdmin,
  pending,
}: {
  count: number
  openCount: number
  onAck: () => void
  onClear: () => void
  ackable: boolean
  isMock: boolean
  isAdmin: boolean
  pending: boolean
}) {
  const ackTooltip = !isAdmin
    ? "ADMIN role required"
    : isMock
    ? "Seed alerts — bulk ack ships with the agent"
    : openCount === 0
    ? "No open alerts in selection"
    : ""
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
        {openCount > 0 && openCount !== count && (
          <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}> · {openCount} open</span>
        )}
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onAck}
        disabled={!ackable || openCount === 0 || pending}
        title={ackTooltip || undefined}
        style={{
          fontSize: "11px",
          padding: "5px 10px",
          borderRadius: "5px",
          border: ackable && openCount > 0 ? "0.5px solid var(--color-accent)" : "0.5px solid var(--color-border-tertiary)",
          background: ackable && openCount > 0 ? "var(--color-accent)" : "transparent",
          color: ackable && openCount > 0 ? "white" : "var(--color-text-muted)",
          cursor: !ackable || openCount === 0 || pending ? "not-allowed" : "pointer",
        }}
      >
        Ack {openCount > 0 ? `· ${openCount}` : ""}
      </button>
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
