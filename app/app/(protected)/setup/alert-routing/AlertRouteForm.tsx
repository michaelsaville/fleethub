"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FIELD, TYPOGRAPHY, CARD } from "@/lib/ui-tokens"
import { Button } from "@/components/ui/Button"

// Phase 7 Workstream A step 3 — shared editor for create + edit.
// No client-side state machine beyond local form state; all
// persistence goes through /api/admin/alert-routes.

type ChannelType = "slack" | "teams" | "email" | "sms" | "pagerduty" | "ticket"
type Severity = "critical" | "warn" | "info"

interface ChannelDraft {
  type: ChannelType
  webhookUrl: string
  toEmails: string         // email — comma-separated
  ccEmails: string         // email — comma-separated
  phoneNumbers: string     // sms   — comma-separated E.164
  integrationKey: string   // pagerduty
  oncallScheduleId: string // email/sms — when set, recipients resolved at dispatch
}

export interface OncallOption {
  id: string
  name: string
}

interface EscalationStepDraft {
  afterMin: number
  channels: ChannelDraft[]
}

export interface AlertRouteFormInput {
  id: string | null
  tenantName: string | null
  severity: Severity[]
  kindLike: string
  channels: ChannelDraft[]
  escalation: EscalationStepDraft[]
  dedupWindowMin: number
  priority: number
  isActive: boolean
}

// FIELD_STYLE replaced by canonical FIELD token from
// @/lib/ui-tokens (WS-C step 2 migration).
const FIELD_STYLE = FIELD

export default function AlertRouteForm({
  initial,
  tenantOptions,
  oncallOptions,
}: {
  initial: AlertRouteFormInput
  tenantOptions: string[]
  oncallOptions: OncallOption[]
}) {
  const router = useRouter()
  const [tenantName, setTenantName] = useState<string>(initial.tenantName ?? "")
  const [severity, setSeverity] = useState<Severity[]>(initial.severity)
  const [kindLike, setKindLike] = useState(initial.kindLike)
  const [channels, setChannels] = useState<ChannelDraft[]>(
    initial.channels.length > 0 ? initial.channels : [{ type: "slack", webhookUrl: "", toEmails: "", ccEmails: "", phoneNumbers: "", integrationKey: "", oncallScheduleId: "" }],
  )
  const [escalation, setEscalation] = useState<EscalationStepDraft[]>(initial.escalation)
  const [dedup, setDedup] = useState(initial.dedupWindowMin)
  const [priority, setPriority] = useState(initial.priority)
  const [isActive, setIsActive] = useState(initial.isActive)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isEdit = initial.id !== null

  function toggleSeverity(s: Severity) {
    setSeverity((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  function addChannel(type: ChannelType) {
    setChannels((prev) => [...prev, { type, webhookUrl: "", toEmails: "", ccEmails: "", phoneNumbers: "", integrationKey: "", oncallScheduleId: "" }])
  }

  function updateChannel(i: number, patch: Partial<ChannelDraft>) {
    setChannels((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }

  function removeChannel(i: number) {
    setChannels((prev) => prev.filter((_, idx) => idx !== i))
  }

  function addEscalationStep() {
    setEscalation((prev) => [
      ...prev,
      { afterMin: prev.length === 0 ? 5 : 10, channels: [{ type: "slack", webhookUrl: "", toEmails: "", ccEmails: "", phoneNumbers: "", integrationKey: "", oncallScheduleId: "" }] },
    ])
  }
  function removeEscalationStep(i: number) {
    setEscalation((prev) => prev.filter((_, idx) => idx !== i))
  }
  function updateEscalationStep(i: number, patch: Partial<EscalationStepDraft>) {
    setEscalation((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addStepChannel(stepIdx: number, type: ChannelType) {
    updateEscalationStep(stepIdx, {
      channels: [...escalation[stepIdx].channels, { type, webhookUrl: "", toEmails: "", ccEmails: "", phoneNumbers: "", integrationKey: "", oncallScheduleId: "" }],
    })
  }
  function updateStepChannel(stepIdx: number, chIdx: number, patch: Partial<ChannelDraft>) {
    updateEscalationStep(stepIdx, {
      channels: escalation[stepIdx].channels.map((c, idx) => (idx === chIdx ? { ...c, ...patch } : c)),
    })
  }
  function removeStepChannel(stepIdx: number, chIdx: number) {
    updateEscalationStep(stepIdx, {
      channels: escalation[stepIdx].channels.filter((_, idx) => idx !== chIdx),
    })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const serializeChannel = (c: ChannelDraft) => {
      if (c.type === "slack" || c.type === "teams") {
        return { type: c.type, webhookUrl: c.webhookUrl.trim() }
      }
      if (c.type === "sms") {
        const sms: {
          type: "sms"
          phoneNumbers: string[]
          oncallScheduleId?: string
        } = {
          type: "sms",
          phoneNumbers: c.phoneNumbers.split(",").map((s) => s.trim()).filter(Boolean),
        }
        if (c.oncallScheduleId) sms.oncallScheduleId = c.oncallScheduleId
        return sms
      }
      if (c.type === "pagerduty") {
        return { type: "pagerduty" as const, integrationKey: c.integrationKey.trim() }
      }
      if (c.type === "ticket") {
        return { type: "ticket" as const }
      }
      const email: {
        type: "email"
        toEmails: string[]
        ccEmails: string[]
        oncallScheduleId?: string
      } = {
        type: "email",
        toEmails: c.toEmails.split(",").map((s) => s.trim()).filter(Boolean),
        ccEmails: c.ccEmails.split(",").map((s) => s.trim()).filter(Boolean),
      }
      if (c.oncallScheduleId) email.oncallScheduleId = c.oncallScheduleId
      return email
    }
    const body = {
      tenantName: tenantName.trim() || null,
      match: {
        severity,
        kindLike: kindLike.trim() || undefined,
      },
      channels: channels.map(serializeChannel),
      escalation: escalation.map((s) => ({
        afterMin: s.afterMin,
        channels: s.channels.map(serializeChannel),
      })),
      dedupWindowMin: dedup,
      priority,
      isActive,
    }
    try {
      const url = isEdit
        ? `/api/admin/alert-routes/${initial.id}`
        : `/api/admin/alert-routes`
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      router.push("/setup/alert-routing")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!isEdit) return
    if (!confirm(`Delete this route? Historical dispatches stay in the audit log, but this rule will no longer evaluate.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/alert-routes/${initial.id}`, { method: "DELETE" })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Delete failed (HTTP ${res.status})`)
        setDeleting(false)
        return
      }
      router.push("/setup/alert-routing")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setDeleting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Scope">
        <Field label="Tenant" hint="Pick a client, or leave blank to apply to all tenants. Tenant-specific routes beat null-tenant ones at the same priority.">
          <select value={tenantName} onChange={(e) => setTenantName(e.target.value)} style={{ ...FIELD_STYLE, width: 320 }}>
            <option value="">(all tenants — default fallback)</option>
            {tenantOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Match">
        <Field label="Severity" hint="When empty, matches any severity. Select one or more to scope this route.">
          <div style={{ display: "flex", gap: 8 }}>
            {(["critical", "warn", "info"] as Severity[]).map((s) => (
              <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={severity.includes(s)} onChange={() => toggleSeverity(s)} />
                {s}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Kind glob" hint='Like "disk.*", "agent.disconnected", or "*" for any. Case-insensitive.'>
          <input type="text" value={kindLike} onChange={(e) => setKindLike(e.target.value)} placeholder="disk.* (optional)" style={{ ...FIELD_STYLE, width: 320 }} />
        </Field>
      </Section>

      <Section title="Channels">
        {channels.map((c, i) => (
          <ChannelRow
            key={i}
            channel={c}
            oncallOptions={oncallOptions}
            onChange={(patch) => updateChannel(i, patch)}
            onRemove={channels.length > 1 ? () => removeChannel(i) : null}
          />
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <AddButton onClick={() => addChannel("slack")}>+ Slack</AddButton>
          <AddButton onClick={() => addChannel("teams")}>+ Teams</AddButton>
          <AddButton onClick={() => addChannel("email")}>+ Email</AddButton>
          <AddButton onClick={() => addChannel("sms")}>+ SMS</AddButton>
          <AddButton onClick={() => addChannel("pagerduty")}>+ PagerDuty</AddButton>
          <AddButton onClick={() => addChannel("ticket")}>+ TicketHub</AddButton>
        </div>
      </Section>

      <Section title="Escalation chain">
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          When the alert isn&rsquo;t acked within{" "}
          <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>afterMin</code>
          {" "}minutes, the next step fires. A cron worker handles the
          timing — check{" "}
          <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>
            /api/cron/alert-escalator
          </code>
          {" "}is in the host crontab (every 1m).
        </span>
        {escalation.map((step, stepIdx) => (
          <div
            key={stepIdx}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "10px 12px",
              background: "var(--color-background-primary, #fff)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Step {stepIdx + 1}
              </span>
              <span style={{ fontSize: 12 }}>After</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={step.afterMin}
                onChange={(e) => updateEscalationStep(stepIdx, { afterMin: Number(e.target.value) })}
                style={{ ...FIELD_STYLE, width: 80 }}
              />
              <span style={{ fontSize: 12 }}>minutes, send to:</span>
              <button
                type="button"
                onClick={() => removeEscalationStep(stepIdx)}
                style={{ marginLeft: "auto", padding: "3px 7px", fontSize: 11, color: "var(--color-text-muted)", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4, cursor: "pointer" }}
              >
                Remove step
              </button>
            </div>
            {step.channels.map((c, chIdx) => (
              <ChannelRow
                key={chIdx}
                channel={c}
                oncallOptions={oncallOptions}
                onChange={(patch) => updateStepChannel(stepIdx, chIdx, patch)}
                onRemove={step.channels.length > 1 ? () => removeStepChannel(stepIdx, chIdx) : null}
              />
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <AddButton onClick={() => addStepChannel(stepIdx, "slack")}>+ Slack</AddButton>
              <AddButton onClick={() => addStepChannel(stepIdx, "teams")}>+ Teams</AddButton>
              <AddButton onClick={() => addStepChannel(stepIdx, "email")}>+ Email</AddButton>
              <AddButton onClick={() => addStepChannel(stepIdx, "sms")}>+ SMS</AddButton>
              <AddButton onClick={() => addStepChannel(stepIdx, "pagerduty")}>+ PagerDuty</AddButton>
              <AddButton onClick={() => addStepChannel(stepIdx, "ticket")}>+ TicketHub</AddButton>
            </div>
          </div>
        ))}
        <div>
          <AddButton onClick={addEscalationStep}>+ Add escalation step</AddButton>
        </div>
      </Section>

      <Section title="Behavior">
        <Field label="Priority" hint="Lower numbers evaluate first. Default 100; tenant-specific routes typically 50 to beat the default.">
          <input type="number" min={0} max={1000} value={priority} onChange={(e) => setPriority(Number(e.target.value))} style={{ ...FIELD_STYLE, width: 100 }} />
        </Field>
        <Field label="Dedup window (minutes)" hint="Suppress repeat dispatches for the same (kind, device) within this window. 0 disables dedup.">
          <input type="number" min={0} max={1440} value={dedup} onChange={(e) => setDedup(Number(e.target.value))} style={{ ...FIELD_STYLE, width: 100 }} />
        </Field>
        <Field label="Active" hint="Inactive routes are skipped during evaluation but stay in the table for quick re-enable.">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            evaluated
          </label>
        </Field>
      </Section>

      {error && (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--color-danger, #b91c1c)", background: "var(--color-danger-soft, rgba(239, 68, 68, 0.1))", borderRadius: 6 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {isEdit && (
          <Button
            type="button"
            variant="danger"
            onClick={onDelete}
            disabled={deleting || submitting}
            style={{ marginRight: "auto", background: "transparent", color: "var(--color-danger)", border: "0.5px solid var(--color-danger)" }}
          >
            {deleting ? "Deleting…" : "Delete route"}
          </Button>
        )}
        <Link
          href="/setup/alert-routing"
          style={{ padding: "8px 14px", fontSize: 13, color: "var(--color-text-secondary)", textDecoration: "none", borderRadius: "var(--radius-sm)" }}
        >
          Cancel
        </Link>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Create route"}
        </Button>
      </div>
    </form>
  )
}

function ChannelRow({
  channel,
  oncallOptions,
  onChange,
  onRemove,
}: {
  channel: ChannelDraft
  oncallOptions: OncallOption[]
  onChange: (patch: Partial<ChannelDraft>) => void
  onRemove: (() => void) | null
}) {
  const useOncall = channel.oncallScheduleId !== ""
  const canUseOncall = channel.type === "email" || channel.type === "sms"
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: "var(--color-background-primary, #fff)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", width: 50 }}>{channel.type}</span>
      {channel.type === "slack" || channel.type === "teams" ? (
        <input
          type="url"
          value={channel.webhookUrl}
          onChange={(e) => onChange({ webhookUrl: e.target.value })}
          placeholder={channel.type === "slack" ? "https://hooks.slack.com/services/..." : "https://*.webhook.office.com/..."}
          style={{ ...FIELD_STYLE, flex: 1 }}
        />
      ) : channel.type === "sms" ? (
        useOncall ? (
          <select
            value={channel.oncallScheduleId}
            onChange={(e) => onChange({ oncallScheduleId: e.target.value })}
            style={{ ...FIELD_STYLE, flex: 1 }}
          >
            <option value="">(pick a schedule)</option>
            {oncallOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : (
          <input
            type="text"
            value={channel.phoneNumbers}
            onChange={(e) => onChange({ phoneNumbers: e.target.value })}
            placeholder="+14155551234, +14155555678 (E.164 only)"
            style={{ ...FIELD_STYLE, flex: 1 }}
          />
        )
      ) : channel.type === "pagerduty" ? (
        <input
          type="text"
          value={channel.integrationKey}
          onChange={(e) => onChange({ integrationKey: e.target.value })}
          placeholder="Events API v2 integration key (32 hex chars)"
          style={{ ...FIELD_STYLE, flex: 1, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
        />
      ) : channel.type === "ticket" ? (
        <span style={{ flex: 1, fontSize: 12, color: "var(--color-text-muted)" }}>
          Auto-creates a TicketHub ticket. Priority + board are derived from severity + kind on the TH side. Idempotent per alert.id.
        </span>
      ) : useOncall ? (
        <select
          value={channel.oncallScheduleId}
          onChange={(e) => onChange({ oncallScheduleId: e.target.value })}
          style={{ ...FIELD_STYLE, flex: 1 }}
        >
          <option value="">(pick a schedule)</option>
          {oncallOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      ) : (
        <div style={{ display: "flex", gap: 6, flex: 1 }}>
          <input
            type="text"
            value={channel.toEmails}
            onChange={(e) => onChange({ toEmails: e.target.value })}
            placeholder="To: a@example.com, b@example.com"
            style={{ ...FIELD_STYLE, flex: 1 }}
          />
          <input
            type="text"
            value={channel.ccEmails}
            onChange={(e) => onChange({ ccEmails: e.target.value })}
            placeholder="Cc: (optional)"
            style={{ ...FIELD_STYLE, flex: 1 }}
          />
        </div>
      )}
      {canUseOncall && oncallOptions.length > 0 && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={useOncall}
            onChange={(e) => onChange({ oncallScheduleId: e.target.checked ? (oncallOptions[0]?.id ?? "") : "" })}
          />
          on-call
        </label>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} style={{ padding: "4px 8px", fontSize: 11, color: "var(--color-text-muted)", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4, cursor: "pointer" }}>
          ✕
        </button>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...CARD, display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px" }}>
      <h2 style={TYPOGRAPHY.LABEL_CAPS}>{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-secondary)" }}>{label}</span>
      {children}
      {hint && <span style={TYPOGRAPHY.HINT}>{hint}</span>}
    </div>
  )
}

function AddButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", border: "0.5px dashed var(--color-border-tertiary)", borderRadius: 6, cursor: "pointer" }}>
      {children}
    </button>
  )
}
