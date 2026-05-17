"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Chip } from "@/components/ui/Chip"
import { ConfirmModal } from "@/components/ui/ConfirmModal"

interface WebhookRow {
  id: string
  name: string
  tenantName: string
  source: string
  isActive: boolean
  lastFiredAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  fireCount: number
  errorCount: number
  createdAt: string
}

export function InboundWebhooksClient({
  rows,
  tenants,
  sources,
  publicUrl,
}: {
  rows: WebhookRow[]
  tenants: string[]
  sources: string[]
  publicUrl: string
}) {
  const router = useRouter()
  const [pendingDelete, setPendingDelete] = useState<WebhookRow | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [revealing, setRevealing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function reveal(id: string) {
    setError(null)
    setRevealing(id)
    try {
      const res = await fetch(`/api/admin/inbound-webhooks/${id}/reveal`, { method: "POST" })
      const j = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
      if (!res.ok || !j.token) {
        setError(j.error ?? "Failed to reveal token")
        return
      }
      setRevealed((s) => ({ ...s, [id]: j.token! }))
    } finally {
      setRevealing(null)
    }
  }

  function toggleActive(row: WebhookRow) {
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/admin/inbound-webhooks/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? "Toggle failed")
        return
      }
      router.refresh()
    })
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const res = await fetch(`/api/admin/inbound-webhooks/${pendingDelete.id}`, { method: "DELETE" })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(j.error ?? "Delete failed")
    }
    router.refresh()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <NewWebhookForm sources={sources} tenants={tenants} />

      {error && (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--color-danger)", background: "var(--color-danger-soft)", borderRadius: 6 }}>
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{
          padding: 40,
          textAlign: "center",
          color: "var(--color-text-muted)",
          fontSize: 13,
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--radius-md)",
        }}>
          No inbound webhooks configured.
        </div>
      ) : (
        <div style={{
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--radius-md)",
          overflowX: "auto",
        }}>
          <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", fontSize: "12.5px" }}>
            <thead>
              <tr style={{ background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))" }}>
                <Th align="left">Name</Th>
                <Th align="left">Source</Th>
                <Th align="left">Tenant</Th>
                <Th align="right">Fires</Th>
                <Th align="right">Errors</Th>
                <Th align="left">Last activity</Th>
                <Th align="center">State</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tokenShown = revealed[r.id]
                return (
                  <tr key={r.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)", verticalAlign: "top" }}>
                    <Td align="left">
                      <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{r.name}</div>
                      {tokenShown ? (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                          <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, color: "var(--color-text-secondary)", wordBreak: "break-all" }}>
                            {publicUrl}/api/inbound/{tokenShown}
                          </code>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard?.writeText(`${publicUrl}/api/inbound/${tokenShown}`)}
                              style={tinyBtn}
                            >
                              Copy URL
                            </button>
                            <button
                              type="button"
                              onClick={() => setRevealed((s) => { const c = { ...s }; delete c[r.id]; return c })}
                              style={tinyBtn}
                            >
                              Hide
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => reveal(r.id)}
                          disabled={revealing === r.id}
                          style={{ ...tinyBtn, marginTop: 6 }}
                        >
                          {revealing === r.id ? "Revealing…" : "Reveal URL"}
                        </button>
                      )}
                    </Td>
                    <Td align="left"><code style={codeStyle}>{r.source}</code></Td>
                    <Td align="left">{r.tenantName}</Td>
                    <Td align="right">{r.fireCount}</Td>
                    <Td align="right">
                      {r.errorCount === 0 ? (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      ) : (
                        <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>{r.errorCount}</span>
                      )}
                    </Td>
                    <Td align="left">
                      {r.lastFiredAt ? (
                        <div>fired {relativeAge(r.lastFiredAt)}</div>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>never fired</span>
                      )}
                      {r.lastErrorAt && r.lastError && (
                        <div style={{ marginTop: 4, color: "var(--color-danger)", fontSize: 11 }}>
                          error {relativeAge(r.lastErrorAt)}: {truncate(r.lastError, 60)}
                        </div>
                      )}
                    </Td>
                    <Td align="center">
                      {r.isActive ? <Chip tone="ok">active</Chip> : <Chip tone="neutral">disabled</Chip>}
                    </Td>
                    <Td align="right">
                      <button type="button" onClick={() => toggleActive(r)} disabled={pending} style={tinyBtn}>
                        {r.isActive ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(r)}
                        style={{ ...tinyBtn, marginLeft: 6, color: "var(--color-danger)" }}
                      >
                        Delete
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Delete this inbound webhook?"
        body={
          pendingDelete
            ? `The token will stop working immediately. Past fires + alerts are retained.`
            : "The token will stop working immediately."
        }
        confirmLabel="Delete webhook"
        tone="danger"
        typedName={pendingDelete ? { expected: pendingDelete.name, prompt: `Type "${pendingDelete.name}" to confirm:` } : undefined}
      />
    </div>
  )
}

function NewWebhookForm({ sources, tenants }: { sources: string[]; tenants: string[] }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [source, setSource] = useState(sources[0] ?? "")
  const [tenantName, setTenantName] = useState(tenants[0] ?? "")
  const [configJson, setConfigJson] = useState("")
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { name: name.trim(), source, tenantName }
      if (configJson.trim()) body.configJson = configJson.trim()
      const res = await fetch("/api/admin/inbound-webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Failed (HTTP ${res.status})`)
        return
      }
      setName("")
      setConfigJson("")
      setOpen(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          background: "var(--color-accent, #F97316)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 8,
          border: "none",
          cursor: "pointer",
        }}
      >
        + New webhook
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--radius-md)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        New inbound webhook
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(160px, 220px) minmax(180px, 1fr)", gap: 10 }}>
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Acme UptimeRobot"'
            required
            maxLength={120}
            style={inputStyle}
          />
        </Field>
        <Field label="Source">
          <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Tenant">
          <select value={tenantName} onChange={(e) => setTenantName(e.target.value)} required style={inputStyle}>
            <option value="">(pick one)</option>
            {tenants.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Config JSON (optional)">
        <textarea
          value={configJson}
          onChange={(e) => setConfigJson(e.target.value)}
          rows={3}
          placeholder='{"hmacSecret":"..."} for sentry · {"allowBatch":true} for generic · etc.'
          style={{ ...inputStyle, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12 }}
        />
      </Field>
      {error && (
        <div style={{ padding: "6px 10px", fontSize: 11.5, color: "var(--color-danger)", background: "var(--color-danger-soft)", borderRadius: 5 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={() => setOpen(false)} disabled={submitting} style={tinyBtn}>
          Cancel
        </button>
        <button type="submit" disabled={submitting} style={{
          padding: "6px 14px",
          background: "var(--color-accent, #F97316)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: submitting ? "wait" : "pointer",
        }}>
          {submitting ? "Creating…" : "Create webhook"}
        </button>
      </div>
    </form>
  )
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

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return (
    <th style={{ padding: "8px 12px", textAlign: align, fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
      {children}
    </th>
  )
}
function Td({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return <td style={{ padding: "10px 12px", textAlign: align }}>{children}</td>
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 13,
  borderRadius: 5,
  background: "var(--color-background-tertiary)",
  border: "0.5px solid var(--color-border-secondary)",
  color: "var(--color-text-primary)",
}
const tinyBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  background: "transparent",
  color: "var(--color-text-secondary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: 5,
  cursor: "pointer",
}
const codeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 11.5,
}
