"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface ScheduleRow {
  id: string
  tenantName: string
  kind: string
  audience: string
  cron: string
  timezone: string
  dateRange: string
  deliveryJson: string
  isActive: boolean
  lastFiredAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  createdBy: string
  createdAt: string
}

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "patch-compliance", label: "Patch Compliance" },
  { value: "software-inventory", label: "Software Inventory" },
  { value: "performance-trend", label: "Performance Trend" },
  { value: "qbr", label: "Quarterly Business Review" },
  { value: "identity-posture", label: "Identity Posture" },
]
const DATE_RANGE_OPTIONS = [
  "last-7d",
  "last-30d",
  "last-90d",
  "month-to-date",
  "quarter-to-date",
] as const

const CRON_PRESETS: Array<{ label: string; value: string; help: string }> = [
  { label: "Daily 08:00 UTC", value: "0 8 * * *", help: "Every day at 08:00" },
  { label: "Weekly Monday 08:00 UTC", value: "0 8 * * 1", help: "Mondays at 08:00" },
  { label: "Monthly 1st 08:00 UTC", value: "0 8 1 * *", help: "1st of every month" },
  { label: "Quarterly (1st of Jan/Apr/Jul/Oct)", value: "0 8 1 1,4,7,10 *", help: "First day of each quarter" },
]

export default function ScheduledReportsClient({
  tenants,
  initialSchedules,
}: {
  tenants: string[]
  initialSchedules: ScheduleRow[]
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [tenantName, setTenantName] = useState(tenants[0] ?? "")
  const [kind, setKind] = useState("qbr")
  const [audience, setAudience] = useState<"client" | "tech" | "auditor">("client")
  const [cron, setCron] = useState(CRON_PRESETS[1].value)
  const [timezone, setTimezone] = useState("UTC")
  const [dateRange, setDateRange] = useState<(typeof DATE_RANGE_OPTIONS)[number]>("last-30d")
  const [emailTo, setEmailTo] = useState("")
  const [emailCc, setEmailCc] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/report-schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantName, kind, audience, cron, timezone, dateRange, emailTo, emailCc,
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j.error || "Failed to create schedule")
        return
      }
      setCreating(false)
      setEmailTo("")
      setEmailCc("")
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteSchedule(id: string) {
    if (!confirm("Delete this schedule? It will stop firing immediately.")) return
    const res = await fetch(`/api/report-schedules/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error || "Failed to delete")
      return
    }
    router.refresh()
  }

  async function toggleActive(id: string, isActive: boolean) {
    const res = await fetch(`/api/report-schedules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error || "Failed to toggle")
      return
    }
    router.refresh()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {!creating && (
          <button onClick={() => setCreating(true)} style={primaryBtn}>
            + New schedule
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={submit} style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New schedule</div>

          <div style={fieldGrid}>
            <Field label="Tenant">
              <select value={tenantName} onChange={(e) => setTenantName(e.target.value)} style={inputStyle}>
                {tenants.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Kind">
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
                {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Audience">
              <select value={audience} onChange={(e) => setAudience(e.target.value as "client" | "tech" | "auditor")} style={inputStyle}>
                <option value="client">Client</option>
                <option value="tech">Tech</option>
                <option value="auditor">Auditor</option>
              </select>
            </Field>
            <Field label="Date range">
              <select value={dateRange} onChange={(e) => setDateRange(e.target.value as (typeof DATE_RANGE_OPTIONS)[number])} style={inputStyle}>
                {DATE_RANGE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Cron expression">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="e.g. 0 8 * * 1"
                style={{ ...inputStyle, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setCron(p.value)}
                    title={p.help}
                    style={presetBtn(cron === p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </Field>

          <Field label="Timezone">
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={inputStyle} />
          </Field>

          <Field label="Email recipients (To)">
            <input
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
              style={inputStyle}
            />
          </Field>
          <Field label="Email recipients (Cc)">
            <input
              value={emailCc}
              onChange={(e) => setEmailCc(e.target.value)}
              placeholder="optional"
              style={inputStyle}
            />
          </Field>

          {error && <div style={errorStyle}>{error}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button type="submit" disabled={submitting} style={primaryBtn}>
              {submitting ? "Saving…" : "Create schedule"}
            </button>
            <button type="button" onClick={() => setCreating(false)} style={secondaryBtn}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div style={cardStyle}>
        {initialSchedules.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            No schedules yet. Click "+ New schedule" above to create one.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={theadRow}>
                <th style={thStyle}>Tenant</th>
                <th style={thStyle}>Kind</th>
                <th style={thStyle}>Cron</th>
                <th style={thStyle}>Range</th>
                <th style={thStyle}>Recipients</th>
                <th style={thStyle}>Last fired</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {initialSchedules.map((s) => {
                const delivery = parseDelivery(s.deliveryJson)
                const recipients = delivery.email?.to ?? []
                return (
                  <tr key={s.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={tdStyle}>{s.tenantName}</td>
                    <td style={{ ...tdStyle, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                      {s.kind}
                      <span style={{ color: "var(--color-text-muted)", marginLeft: 6 }}>({s.audience})</span>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                      {s.cron} <span style={{ color: "var(--color-text-muted)" }}>{s.timezone}</span>
                    </td>
                    <td style={tdStyle}>{s.dateRange}</td>
                    <td style={tdStyle}>{recipients.join(", ") || <span style={{ color: "var(--color-text-muted)" }}>none</span>}</td>
                    <td style={tdStyle}>
                      {s.lastFiredAt ? new Date(s.lastFiredAt).toLocaleString() : <span style={{ color: "var(--color-text-muted)" }}>never</span>}
                      {s.lastError && (
                        <div style={{ fontSize: 10.5, color: "var(--color-danger)", marginTop: 2 }}>
                          {trim(s.lastError, 80)}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 3,
                          background: s.isActive ? "var(--color-success)" : "var(--color-text-muted)",
                          color: "#fff",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {s.isActive ? "active" : "paused"}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button onClick={() => toggleActive(s.id, s.isActive)} style={smallBtn}>
                        {s.isActive ? "Pause" : "Resume"}
                      </button>
                      <button onClick={() => deleteSchedule(s.id)} style={{ ...smallBtn, color: "var(--color-danger)", marginLeft: 4 }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function parseDelivery(json: string): { email?: { to: string[]; cc?: string[] } } {
  try { return JSON.parse(json) } catch { return {} }
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const cardStyle: React.CSSProperties = {
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: 10,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 12,
}
const fieldGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
}
const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "7px 10px",
  borderRadius: 6,
  border: "0.5px solid var(--color-border-tertiary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
}
const primaryBtn: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  padding: "8px 16px",
  borderRadius: 6,
  background: "var(--color-accent)",
  color: "#fff",
  border: "0.5px solid var(--color-border-secondary)",
  cursor: "pointer",
}
const secondaryBtn: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  padding: "8px 16px",
  borderRadius: 6,
  background: "transparent",
  color: "var(--color-text-primary)",
  border: "0.5px solid var(--color-border-tertiary)",
  cursor: "pointer",
}
const smallBtn: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 500,
  padding: "4px 9px",
  borderRadius: 5,
  background: "transparent",
  color: "var(--color-text-primary)",
  border: "0.5px solid var(--color-border-tertiary)",
  cursor: "pointer",
}
const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--color-danger)",
  padding: "8px 10px",
  borderRadius: 5,
  background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
}
const theadRow: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
}
const thStyle: React.CSSProperties = { textAlign: "left", padding: "6px 8px", fontWeight: 600 }
const tdStyle: React.CSSProperties = { padding: "6px 8px", verticalAlign: "top" }

function presetBtn(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "4px 9px",
    borderRadius: 5,
    background: active ? "color-mix(in srgb, var(--color-accent) 15%, transparent)" : "transparent",
    color: "var(--color-text-primary)",
    border: "0.5px solid " + (active ? "var(--color-accent)" : "var(--color-border-tertiary)"),
    cursor: "pointer",
  }
}
