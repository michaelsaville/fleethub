"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FIELD, TYPOGRAPHY, CARD } from "@/lib/ui-tokens"
import { Button } from "@/components/ui/Button"

// Phase 8 Workstream A step 3 — new-monitor wizard. Same shape as
// the runbook wizard: four sections (Identity → Metric → Threshold
// → Behavior → Emit), rendered top-to-bottom. v1 is create-only;
// edit/delete land in a follow-up.

type Severity = "critical" | "warn" | "info"
type Operator = "lt" | "gt" | "eq" | "neq"
type OsFilter = "" | "windows" | "linux" | "darwin"

export interface MetricOption {
  /// Machine identifier ("perf.cpu.avg", etc.).
  id: string
  /// Display label ("CPU average %").
  label: string
  /// Short hint shown under the dropdown ("rolling 1-hour average across cores").
  hint: string
  /// Units suffix shown next to the threshold value ("%", "MB", ...).
  unit: string
}

export interface MonitorFormInput {
  name: string
  tenantName: string
  metric: string
  operator: Operator
  value: number
  forMin: number
  osFilter: OsFilter
  severity: Severity
  emitKind: string
  cooldownMin: number
  isActive: boolean
}

export default function MonitorForm({
  metrics,
  tenants,
}: {
  metrics: MetricOption[]
  tenants: string[]
}) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [tenantName, setTenantName] = useState("")
  const [metric, setMetric] = useState(metrics[0]?.id ?? "")
  const [operator, setOperator] = useState<Operator>("gt")
  const [value, setValue] = useState(90)
  const [forMin, setForMin] = useState(15)
  const [osFilter, setOsFilter] = useState<OsFilter>("")
  const [severity, setSeverity] = useState<Severity>("warn")
  const [emitKind, setEmitKind] = useState("")
  const [cooldownMin, setCooldownMin] = useState(30)
  const [isActive, setIsActive] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedMetric = metrics.find((m) => m.id === metric)

  // Live-derived emit kind preview (shown when operator hasn't
  // overridden the default).
  const derivedEmitKind = name.trim()
    ? `monitor.${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled"}`
    : ""

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const body = {
      name: name.trim(),
      tenantName: tenantName.trim() || null,
      metric,
      predicate: {
        operator,
        value: Number(value),
        forMin: Number(forMin),
        ...(osFilter ? { osFilter } : {}),
      },
      severity,
      emitKind: emitKind.trim() || undefined,
      cooldownMin: Number(cooldownMin),
      isActive,
    }
    try {
      const res = await fetch("/api/admin/monitors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      const j = (await res.json().catch(() => ({}))) as { id?: string }
      router.push(j.id ? `/monitors/${j.id}` : "/monitors")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ──────────────── Identity ──────────────── */}
      <Section title="Identity">
        <label style={labelStyle}>
          <span style={TYPOGRAPHY.LABEL_CAPS}>Name *</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Disk > 90% sustained"'
            maxLength={120}
            required
            style={{ ...FIELD, width: "100%" }}
          />
        </label>
        <label style={labelStyle}>
          <span style={TYPOGRAPHY.LABEL_CAPS}>Tenant</span>
          <select
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            style={{ ...FIELD, width: 360 }}
          >
            <option value="">(all tenants)</option>
            {tenants.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <span style={TYPOGRAPHY.HINT}>Empty = applies to every active device, regardless of client.</span>
        </label>
      </Section>

      {/* ──────────────── Metric ──────────────── */}
      <Section title="Metric">
        <label style={labelStyle}>
          <span style={TYPOGRAPHY.LABEL_CAPS}>What to measure *</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            style={{ ...FIELD, width: 360 }}
            required
          >
            {metrics.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          {selectedMetric && (
            <span style={TYPOGRAPHY.HINT}>{selectedMetric.hint}</span>
          )}
        </label>
      </Section>

      {/* ──────────────── Threshold ──────────────── */}
      <Section title="Threshold">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={{ ...labelStyle, flex: "0 0 auto" }}>
            <span style={TYPOGRAPHY.LABEL_CAPS}>Operator</span>
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as Operator)}
              style={{ ...FIELD, width: 90 }}
            >
              <option value="gt">&gt;</option>
              <option value="lt">&lt;</option>
              <option value="eq">=</option>
              <option value="neq">≠</option>
            </select>
          </label>
          <label style={{ ...labelStyle, flex: "0 0 auto" }}>
            <span style={TYPOGRAPHY.LABEL_CAPS}>Value{selectedMetric?.unit ? ` (${selectedMetric.unit})` : ""}</span>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              step="any"
              style={{ ...FIELD, width: 140 }}
              required
            />
          </label>
          <label style={{ ...labelStyle, flex: "0 0 auto" }}>
            <span style={TYPOGRAPHY.LABEL_CAPS}>Sustain (min)</span>
            <input
              type="number"
              value={forMin}
              onChange={(e) => setForMin(Math.max(1, Number(e.target.value)))}
              min={1}
              max={1440}
              style={{ ...FIELD, width: 110 }}
            />
          </label>
          <label style={{ ...labelStyle, flex: "0 0 auto" }}>
            <span style={TYPOGRAPHY.LABEL_CAPS}>OS filter</span>
            <select
              value={osFilter}
              onChange={(e) => setOsFilter(e.target.value as OsFilter)}
              style={{ ...FIELD, width: 160 }}
            >
              <option value="">(any)</option>
              <option value="windows">windows</option>
              <option value="linux">linux</option>
              <option value="darwin">darwin (macOS)</option>
            </select>
          </label>
        </div>
        <p style={{ ...TYPOGRAPHY.HINT, marginTop: 6 }}>
          The cron looks back <code>forMin</code> minutes and fires only when every
          sample in the window violates the threshold. With the current 1-hour
          rollup that&rsquo;s usually one sample — sub-hour granularity lands
          when the agent emits finer rows.
        </p>
      </Section>

      {/* ──────────────── Behavior ──────────────── */}
      <Section title="Behavior">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <label style={{ ...labelStyle, flex: "0 0 auto" }}>
            <span style={TYPOGRAPHY.LABEL_CAPS}>Severity</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              style={{ ...FIELD, width: 160 }}
            >
              <option value="critical">critical</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
            </select>
          </label>
          <label style={{ ...labelStyle, flex: "0 0 auto" }}>
            <span style={TYPOGRAPHY.LABEL_CAPS}>Cooldown (min)</span>
            <input
              type="number"
              value={cooldownMin}
              onChange={(e) => setCooldownMin(Math.max(0, Number(e.target.value)))}
              min={0}
              max={1440}
              style={{ ...FIELD, width: 130 }}
            />
            <span style={TYPOGRAPHY.HINT}>Per (device, monitor). 0 disables.</span>
          </label>
          <label style={{ ...labelStyle, flex: "0 0 auto", flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span style={TYPOGRAPHY.LABEL_CAPS}>Active on save</span>
          </label>
        </div>
      </Section>

      {/* ──────────────── Emit ──────────────── */}
      <Section title="Emit">
        <label style={labelStyle}>
          <span style={TYPOGRAPHY.LABEL_CAPS}>Alert kind to emit</span>
          <input
            type="text"
            value={emitKind}
            onChange={(e) => setEmitKind(e.target.value)}
            placeholder={derivedEmitKind || "monitor.<name>"}
            maxLength={100}
            style={{ ...FIELD, width: 400 }}
          />
          <span style={TYPOGRAPHY.HINT}>
            Leave blank to use the auto-derived default <code>{derivedEmitKind || "monitor.<name>"}</code>.
            Override to match an existing <code>Fl_AlertRoute.matchJson.kindLike</code> rule
            (e.g. <code>disk.full</code>) so routing fires without a new rule.
          </span>
        </label>
      </Section>

      {error && (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--color-danger)", background: "var(--color-danger-soft)", borderRadius: 6 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Link
          href="/monitors"
          style={{ padding: "8px 14px", fontSize: 13, color: "var(--color-text-secondary)", textDecoration: "none", borderRadius: "var(--radius-sm)" }}
        >
          Cancel
        </Link>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create monitor"}
        </Button>
      </div>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...CARD, padding: "14px 16px" }}>
      <header style={{ marginBottom: 12 }}>
        <h2 style={TYPOGRAPHY.LABEL_CAPS}>{title}</h2>
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </section>
  )
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
}
