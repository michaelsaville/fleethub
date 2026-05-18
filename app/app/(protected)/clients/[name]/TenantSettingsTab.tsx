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
  // Phase 10 WS-A §3.4 — Phase 9 + Phase 10 toggles surfaced.
  mfaRequired: boolean
  psaSyncEnabled: boolean
  backupTriggerEnabled: boolean
  backupTriggerRequiresJustification: boolean
  shellSessionsEnabled: boolean
  shellRequiresJustification: boolean
  shellMaxDurationMin: number
  fileTransferEnabled: boolean
  fileTransferRequiresJustification: boolean
  fileTransferMaxSizeMb: number
  timezone: string | null
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

      <Group title="Security (Phase 9 + 10)">
        <Toggle
          label="Require MFA for sign-in"
          hint="When on, every user on this tenant must complete TOTP challenge after Azure AD. Users without enrollment are redirected to /setup/staff/[id]?tab=mfa on next login."
          checked={state.mfaRequired}
          onChange={(v) => patch({ mfaRequired: v })}
        />
      </Group>

      <Group title="Mutable backup (Phase 9 WS-C §5.4)">
        <Toggle
          label="Backup trigger enabled"
          hint="When on, ADMIN can manually trigger the agent's per-product backup binary from /devices/[id]."
          checked={state.backupTriggerEnabled}
          onChange={(v) => patch({ backupTriggerEnabled: v })}
        />
        <Toggle
          label="Justification required"
          hint="When on, the trigger modal forces a non-empty reason field. Audit-row captures it."
          checked={state.backupTriggerRequiresJustification}
          onChange={(v) => patch({ backupTriggerRequiresJustification: v })}
        />
      </Group>

      <Group title="Interactive shell (Phase 9 WS-D §6.1)">
        <Toggle
          label="Shell sessions enabled"
          hint="When on, ADMIN can open an interactive shell on any host in this tenant from /devices/[id]?tab=remote."
          checked={state.shellSessionsEnabled}
          onChange={(v) => patch({ shellSessionsEnabled: v })}
        />
        <Toggle
          label="Justification required"
          hint="When on, the operator must enter a ≥4-char reason to open a session."
          checked={state.shellRequiresJustification}
          onChange={(v) => patch({ shellRequiresJustification: v })}
        />
        <NumberInput
          label="Max duration (min)"
          value={state.shellMaxDurationMin}
          min={1}
          max={1440}
          onChange={(v) => setState((s) => ({ ...s, shellMaxDurationMin: v }))}
          onBlur={() => patch({ shellMaxDurationMin: state.shellMaxDurationMin })}
          hint="The watcher cron auto-closes sessions older than this. Default 60."
        />
      </Group>

      <Group title="File transfer (Phase 9 WS-D §6.2)">
        <Toggle
          label="File transfer enabled"
          hint="When on, ADMIN can push files to or pull files from devices in this tenant."
          checked={state.fileTransferEnabled}
          onChange={(v) => patch({ fileTransferEnabled: v })}
        />
        <Toggle
          label="Justification required"
          hint="Same shape as the shell-sessions toggle."
          checked={state.fileTransferRequiresJustification}
          onChange={(v) => patch({ fileTransferRequiresJustification: v })}
        />
        <NumberInput
          label="Max file size (MB)"
          value={state.fileTransferMaxSizeMb}
          min={1}
          max={10240}
          onChange={(v) => setState((s) => ({ ...s, fileTransferMaxSizeMb: v }))}
          onBlur={() => patch({ fileTransferMaxSizeMb: state.fileTransferMaxSizeMb })}
          hint="Server-side validates per transfer. Default 100."
        />
      </Group>

      <Group title="Integrations (Phase 9 WS-C §5.3 + Phase 10 §5.5)">
        <Toggle
          label="PSA sync enabled"
          hint="When on, the daily 03:00 UTC cron writes active-device count into matching TicketHub TH_ContractRecurringItem.quantity for contracts tagged syncSource=fleethub-endpoint-count."
          checked={state.psaSyncEnabled}
          onChange={(v) => patch({ psaSyncEnabled: v })}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Timezone (IANA name)</Label>
          <input
            type="text"
            value={state.timezone ?? ""}
            placeholder="America/New_York"
            onChange={(e) => setState((s) => ({ ...s, timezone: e.target.value || null }))}
            onBlur={() => patch({ timezone: state.timezone })}
            style={{
              padding: "6px 9px",
              fontSize: 13,
              width: 240,
              background: "var(--color-background-primary, #fff)",
              color: "var(--color-text-primary)",
              border: "0.5px solid var(--color-border-secondary, #d4d4d8)",
              borderRadius: 6,
              outline: "none",
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            Used by on-call schedule TZ preview + future scheduling. Leave blank to fall back to America/New_York.
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

function NumberInput({
  label, hint, value, min, max, onChange, onBlur,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  onBlur: () => void
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Label>{label}</Label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={onBlur}
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
      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{hint}</span>
    </div>
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
