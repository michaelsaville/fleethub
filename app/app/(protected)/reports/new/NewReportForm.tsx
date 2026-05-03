"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

const REPORT_KINDS: Array<{ value: string; label: string; help: string }> = [
  {
    value: "patch-compliance",
    label: "Patch Compliance",
    help: "Per-host patch state, SLA aging, KEV exposure. The HIPAA workhorse.",
  },
  {
    value: "software-inventory",
    label: "Software Inventory",
    help: "Catalog summary, version drift by package, recent deployments.",
  },
]

export default function NewReportForm({ tenants }: { tenants: string[] }) {
  const router = useRouter()
  const [kind, setKind] = useState("patch-compliance")
  const [tenantName, setTenantName] = useState(tenants[0] ?? "")
  const [audience, setAudience] = useState<"client" | "tech" | "auditor">("client")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantName) {
      setError("Pick a tenant.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const create = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, tenantName, audience }),
      })
      const created = await create.json()
      if (!create.ok) {
        setError(created.error || "Failed to create report")
        return
      }
      // Redirect to the report viewer; the viewer auto-fires generate.
      router.push(`/reports/${created.id}?autorun=1`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 10,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <Field label="Tenant">
        <select value={tenantName} onChange={(e) => setTenantName(e.target.value)} style={inputStyle}>
          {tenants.length === 0 && <option value="">(no tenants enrolled)</option>}
          {tenants.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Report kind">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {REPORT_KINDS.map((r) => (
            <label
              key={r.value}
              style={{
                display: "flex",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                border: "0.5px solid",
                borderColor: kind === r.value ? "var(--color-accent)" : "var(--color-border-tertiary)",
                background: kind === r.value ? "color-mix(in srgb, var(--color-accent) 8%, transparent)" : "transparent",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="kind"
                value={r.value}
                checked={kind === r.value}
                onChange={() => setKind(r.value)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{r.help}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Audience">
        <select
          value={audience}
          onChange={(e) => setAudience(e.target.value as "client" | "tech" | "auditor")}
          style={inputStyle}
        >
          <option value="client">Client (executive summary)</option>
          <option value="tech">Tech (full detail)</option>
          <option value="auditor">Auditor (every row, every host)</option>
        </select>
      </Field>

      {error && (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-danger)",
            padding: "8px 10px",
            borderRadius: 5,
            background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
          }}
        >
          {error}
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={submitting || !tenantName}
          style={{
            fontSize: 12,
            fontWeight: 500,
            padding: "8px 16px",
            borderRadius: 6,
            background: "var(--color-accent)",
            color: "#fff",
            border: "0.5px solid var(--color-border-secondary)",
            cursor: submitting ? "wait" : "pointer",
            opacity: submitting || !tenantName ? 0.6 : 1,
          }}
        >
          {submitting ? "Creating…" : "Generate report"}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "7px 10px",
  borderRadius: 6,
  border: "0.5px solid var(--color-border-tertiary)",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
}
