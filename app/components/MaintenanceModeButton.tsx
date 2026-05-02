"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

export default function MaintenanceModeButton({
  deviceId,
  isOn,
  until,
  reason,
}: {
  deviceId: string
  isOn: boolean
  until: string | null
  reason: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [draftUntil, setDraftUntil] = useState("")
  const [draftReason, setDraftReason] = useState(reason ?? "")

  async function call(on: boolean, untilStr?: string, reasonStr?: string) {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { on }
      if (on) {
        if (untilStr) body.until = new Date(untilStr).toISOString()
        if (reasonStr) body.reason = reasonStr
      }
      const res = await fetch(`/api/devices/${deviceId}/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setOpen(false)
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (isOn) {
    return (
      <button
        type="button"
        onClick={() => {
          if (confirm("Take this host out of Maintenance Mode? Deploys + alerts resume.")) {
            call(false)
          }
        }}
        disabled={busy}
        title={`In maintenance${until ? ` until ${new Date(until).toLocaleString()}` : ""}${reason ? `: ${reason}` : ""}`}
        style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 6,
          border: "0.5px solid var(--color-warn)",
          background: "var(--color-warn)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        🔒 Maintenance · click to release
      </button>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 500,
          borderRadius: 6,
          border: "0.5px solid var(--color-border-tertiary)",
          background: "transparent",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        🔒 Maintenance Mode
      </button>
    )
  }

  return (
    <div style={{
      padding: 10,
      background: "var(--color-background-tertiary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: 6,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      minWidth: 360,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>Set Maintenance Mode</div>
      <input
        type="datetime-local"
        value={draftUntil}
        onChange={(e) => setDraftUntil(e.target.value)}
        style={{ fontSize: 12, padding: "6px 8px", borderRadius: 4, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background)", color: "var(--color-text-primary)" }}
      />
      <input
        type="text"
        placeholder="Reason (e.g. Q2 audit; clinical procedure)"
        value={draftReason}
        onChange={(e) => setDraftReason(e.target.value)}
        style={{ fontSize: 12, padding: "6px 8px", borderRadius: 4, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background)", color: "var(--color-text-primary)" }}
      />
      {error && <span style={{ color: "var(--color-danger)", fontSize: 11 }}>{error}</span>}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button onClick={() => setOpen(false)} disabled={busy} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 4, background: "transparent", border: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)", cursor: "pointer" }}>
          Cancel
        </button>
        <button onClick={() => call(true, draftUntil || undefined, draftReason || undefined)} disabled={busy} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 4, background: "var(--color-warn)", border: "0.5px solid var(--color-warn)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
          {busy ? "Setting…" : "Set maintenance"}
        </button>
      </div>
    </div>
  )
}
