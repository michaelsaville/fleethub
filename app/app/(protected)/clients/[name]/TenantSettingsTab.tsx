"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

// Phase 7 — per-tenant toggles. WS-C remote-control booleans +
// WS-D portal booleans. All persist through the existing
// /api/admin/tenants/[name] PATCH (extended to accept these
// fields in the WS-C step 1 + WS-D step 1 commits).

interface State {
  remoteControlEnabled: boolean
  remoteRequiresJustification: boolean
  portalEnabled: boolean
  portalReportMaxAgeDays: number
}

export default function TenantSettingsTab({
  tenantName,
  initial,
}: {
  tenantName: string
  initial: State
}) {
  const router = useRouter()
  const [state, setState] = useState<State>(initial)
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [err, setErr] = useState<string | null>(null)

  async function patch(data: Partial<State>) {
    setSaving("saving")
    setErr(null)
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantName)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `Save failed (${res.status})`)
      setState((s) => ({ ...s, ...data }))
      setSaving("saved")
      setTimeout(() => setSaving((s) => (s === "saved" ? "idle" : s)), 1500)
      router.refresh()
    } catch (e) {
      setSaving("error")
      setErr(e instanceof Error ? e.message : "Save failed")
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 720 }}>
      <Group title="Remote control (Phase 7 WS-C)">
        <Toggle
          label="Remote control enabled"
          hint="When off, the Remote in button on every device in this tenant is disabled with a clear hint."
          checked={state.remoteControlEnabled}
          onChange={(v) => patch({ remoteControlEnabled: v })}
        />
        <Toggle
          label="Justification required"
          hint="When on, every Fl_RemoteSession.create requires a ≥4-char reason. Default-on for HIPAA tenants."
          checked={state.remoteRequiresJustification}
          onChange={(v) => patch({ remoteRequiresJustification: v })}
        />
      </Group>

      <Group title="Customer portal (Phase 7 WS-D)">
        <Toggle
          label="Portal enabled"
          hint={"When on, this tenant's customer portal users see a Fleet page at portal.pcc2k.com/fleet. Read-only by design."}
          checked={state.portalEnabled}
          onChange={(v) => patch({ portalEnabled: v })}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Report visibility window (days)</Label>
          <input
            type="number"
            min={1}
            max={9999}
            value={state.portalReportMaxAgeDays}
            onChange={(e) => setState((s) => ({ ...s, portalReportMaxAgeDays: Number(e.target.value) }))}
            onBlur={() => patch({ portalReportMaxAgeDays: state.portalReportMaxAgeDays })}
            style={{
              padding: "6px 9px",
              fontSize: 13,
              width: 120,
              background: "var(--color-background-primary, #fff)",
              color: "var(--color-text-primary)",
              border: "0.5px solid var(--color-border-secondary, #d4d4d8)",
              borderRadius: 6,
              outline: "none",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            Reports older than this don&rsquo;t surface to /fleet/reports on the customer portal. Default 90.
            HIPAA tenants may want tighter; non-HIPAA may want unlimited (set 9999).
          </span>
        </div>
      </Group>

      <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
        {saving === "saving" && <span>saving…</span>}
        {saving === "saved" && <span style={{ color: "var(--color-success)" }}>saved</span>}
        {saving === "error" && err && <span style={{ color: "var(--color-danger)" }}>{err}</span>}
      </div>
    </section>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, padding: "14px 16px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
      <h2 style={{ fontSize: 12, fontWeight: 600, margin: 0, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</h2>
      {children}
    </section>
  )
}

function Toggle({
  label, hint, checked, onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{hint}</span>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {children}
    </span>
  )
}
