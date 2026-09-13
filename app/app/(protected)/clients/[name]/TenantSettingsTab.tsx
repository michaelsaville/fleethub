"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

// Phase 11 WS-D.1 — per-tenant settings, refactored from one
// 300-line scroll into a left-rail nested-tab layout.
//
// Sub-tabs: Security | Remote | Portal | Backup | Shell | File |
//           Integrations | Policies (NEW Phase 11)
//
// All persist through /api/admin/tenants/[name] PATCH.

type SubTab =
  | "security"
  | "remote"
  | "portal"
  | "backup"
  | "shell"
  | "file"
  | "integrations"
  | "policies"

interface State {
  remoteControlEnabled: boolean
  remoteRequiresJustification: boolean
  portalEnabled: boolean
  portalRemoteEnabled: boolean
  portalReportMaxAgeDays: number
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
  // Phase 11 WS-D
  bulkApprovalThreshold: number
  disclosureRequiresApproval: boolean
  shellApprovalTagsJson: string | null
  sessionMaxHours: number
  passwordExpiryDays: number
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
  const [active, setActive] = useState<SubTab>("security")
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

  const tabs: { id: SubTab; label: string }[] = [
    { id: "security", label: "Security" },
    { id: "remote", label: "Remote" },
    { id: "portal", label: "Portal" },
    { id: "backup", label: "Backup" },
    { id: "shell", label: "Shell" },
    { id: "file", label: "File transfer" },
    { id: "integrations", label: "Integrations" },
    { id: "policies", label: "Policies" },
  ]

  return (
    <section style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 20, maxWidth: 900 }}>
      <nav
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: 8,
          padding: 8,
          alignSelf: "start",
          position: "sticky",
          top: 12,
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            style={{
              textAlign: "left",
              padding: "8px 10px",
              fontSize: 12.5,
              fontWeight: active === t.id ? 600 : 500,
              color: active === t.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              background: active === t.id ? "var(--color-background-primary, #fff)" : "transparent",
              border: 0,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {active === "security" && (
          <Group title="Security">
            <Toggle
              label="Require MFA for sign-in"
              hint="When on, every user on this tenant must complete TOTP challenge after Azure AD. Forced-enrollment users are redirected to /account/security."
              checked={state.mfaRequired}
              onChange={(v) => patch({ mfaRequired: v })}
            />
            <NumberInput
              label="Session max duration (hours)"
              value={state.sessionMaxHours}
              min={1}
              max={168}
              onChange={(v) => setState((s) => ({ ...s, sessionMaxHours: v }))}
              onBlur={() => patch({ sessionMaxHours: state.sessionMaxHours })}
              hint="Sets NextAuth session.maxAge. Defaults to 12 hours (matches MFA cookie TTL). Phase 11 WS-D."
            />
            <NumberInput
              label="Password expiry (days)"
              value={state.passwordExpiryDays}
              min={0}
              max={3650}
              onChange={(v) => setState((s) => ({ ...s, passwordExpiryDays: v }))}
              onBlur={() => patch({ passwordExpiryDays: state.passwordExpiryDays })}
              hint="0 = no expiry. Informational only in v1 (no enforcement). Phase 11 WS-D."
            />
          </Group>
        )}

        {active === "remote" && (
          <Group title="Remote control (Phase 7 WS-C)">
            <Toggle
              label="Remote control enabled"
              hint="When off, the Remote-in button on every device in this tenant is disabled with a clear hint."
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
        )}

        {active === "portal" && (
          <Group title="Customer portal (Phase 7 WS-D)">
            <Toggle
              label="Portal enabled"
              hint="When on, this tenant's customer portal users see a Fleet page at portal.pcc2k.com/fleet. Read-only by design."
              checked={state.portalEnabled}
              onChange={(v) => patch({ portalEnabled: v })}
            />
            <Toggle
              label="Customer remote access"
              hint="When on, portal users you've shared a device with (device page → Remote → Share with client) get a Remote access button that opens ControlR's viewer for that device only. Off = existing shares are inert."
              checked={state.portalRemoteEnabled}
              onChange={(v) => patch({ portalRemoteEnabled: v })}
            />
            <NumberInput
              label="Report visibility window (days)"
              value={state.portalReportMaxAgeDays}
              min={1}
              max={9999}
              onChange={(v) => setState((s) => ({ ...s, portalReportMaxAgeDays: v }))}
              onBlur={() => patch({ portalReportMaxAgeDays: state.portalReportMaxAgeDays })}
              hint="Reports older than this don't surface to /fleet/reports. Default 90. HIPAA may want tighter; non-HIPAA may want unlimited (9999)."
            />
          </Group>
        )}

        {active === "backup" && (
          <Group title="Mutable backup (Phase 9 WS-C §5.4)">
            <Toggle
              label="Backup trigger enabled"
              hint="When on, ADMIN can manually trigger the agent's per-product backup binary from /devices/[id]. Audit-only; no 4-eyes (reversible op)."
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
        )}

        {active === "shell" && (
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
            <TextInput
              label="Tags requiring peer approval (JSON array)"
              value={state.shellApprovalTagsJson ?? ""}
              placeholder='["prod","finance"]'
              onChange={(v) => setState((s) => ({ ...s, shellApprovalTagsJson: v || null }))}
              onBlur={() => patch({ shellApprovalTagsJson: state.shellApprovalTagsJson })}
              hint="Phase 11 WS-B. When a device's role matches any tag here, shell.open routes through 4-eyes approval. Empty / null = no approval gate. Operator sets device.role on the device editor."
            />
          </Group>
        )}

        {active === "file" && (
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
        )}

        {active === "integrations" && (
          <Group title="Integrations (Phase 9 WS-C §5.3 + Phase 10 §5.5)">
            <Toggle
              label="PSA sync enabled"
              hint="When on, the daily 03:00 UTC cron writes active-device count into matching TicketHub TH_ContractRecurringItem.quantity for contracts tagged syncSource=fleethub-endpoint-count."
              checked={state.psaSyncEnabled}
              onChange={(v) => patch({ psaSyncEnabled: v })}
            />
            <TextInput
              label="Timezone (IANA name)"
              value={state.timezone ?? ""}
              placeholder="America/New_York"
              onChange={(v) => setState((s) => ({ ...s, timezone: v || null }))}
              onBlur={() => patch({ timezone: state.timezone })}
              hint="Used by on-call schedule TZ preview + future scheduling. Leave blank to fall back to America/New_York."
            />
          </Group>
        )}

        {active === "policies" && (
          <Group title="Policies (Phase 11 WS-D)">
            <NumberInput
              label="Bulk approval threshold (device count)"
              value={state.bulkApprovalThreshold}
              min={1}
              max={100000}
              onChange={(v) => setState((s) => ({ ...s, bulkApprovalThreshold: v }))}
              onBlur={() => patch({ bulkApprovalThreshold: state.bulkApprovalThreshold })}
              hint="Bulk dispatch / maintenance / deployment touching more than N devices in this tenant routes through 4-eyes peer approval. Default 50. Uninstall verb is always gated regardless of count."
            />
            <Toggle
              label="Credential disclose + update require peer approval"
              hint="When on, credential.disclose AND credential.update for this tenant require 4-eyes approval IN ADDITION TO step-up authentication. Recommended for HIPAA tenants."
              checked={state.disclosureRequiresApproval}
              onChange={(v) => patch({ disclosureRequiresApproval: v })}
            />
            <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", padding: "8px 0", borderTop: "0.5px dashed var(--color-border-tertiary)" }}>
              See the <strong>Shell</strong> subtab for device-tag-scoped shell-open
              approval. See <strong>/approvals</strong> for the pending-request inbox.
            </div>
          </Group>
        )}

        <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
          {saving === "saving" && <span>saving…</span>}
          {saving === "saved" && <span style={{ color: "var(--color-success)" }}>saved</span>}
          {saving === "error" && err && <span style={{ color: "var(--color-danger)" }}>{err}</span>}
        </div>
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

function TextInput({
  label, hint, value, placeholder, onChange, onBlur,
}: {
  label: string
  hint: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  onBlur: () => void
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Label>{label}</Label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{
          padding: "6px 9px",
          fontSize: 13,
          width: 280,
          background: "var(--color-background-primary, #fff)",
          color: "var(--color-text-primary)",
          border: "0.5px solid var(--color-border-secondary, #d4d4d8)",
          borderRadius: 6,
          outline: "none",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
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
