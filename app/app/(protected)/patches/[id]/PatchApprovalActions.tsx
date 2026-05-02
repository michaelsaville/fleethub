"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

interface Props {
  patchId: string
  currentState: string
  isAdmin: boolean
}

const STATE_LABEL: Record<string, string> = {
  approved: "Approved",
  declined: "Declined",
  deferred: "Deferred",
  "needs-approval": "Needs approval",
  "auto-declined": "Auto-declined",
}

export default function PatchApprovalActions({ patchId, currentState, isAdmin }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (!isAdmin) {
    return (
      <span style={muted}>
        Approval action requires ADMIN. Current state: <strong>{STATE_LABEL[currentState] ?? currentState}</strong>.
      </span>
    )
  }

  async function set(state: "approved" | "declined" | "deferred", confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return
    let notes: string | undefined
    if (state === "declined") {
      const entered = prompt("Reason for decline (optional but recommended):", "")
      if (entered === null) return
      notes = entered.trim() || undefined
    }
    setBusy(state)
    setError(null)
    try {
      const res = await fetch(`/api/patches/${patchId}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, notes }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {currentState !== "approved" && (
        <button
          onClick={() => set("approved")}
          disabled={busy !== null}
          style={btn("var(--color-success)")}
        >
          {busy === "approved" ? "Approving…" : "Approve"}
        </button>
      )}
      {currentState !== "deferred" && (
        <button
          onClick={() => set("deferred")}
          disabled={busy !== null}
          style={btn("var(--color-text-muted)")}
        >
          {busy === "deferred" ? "Deferring…" : "Defer"}
        </button>
      )}
      {currentState !== "declined" && (
        <button
          onClick={() => set("declined", "Decline this patch? Operators will not be able to launch deploys against it.")}
          disabled={busy !== null}
          style={btn("var(--color-danger)")}
        >
          {busy === "declined" ? "Declining…" : "Decline"}
        </button>
      )}
      {error && <span style={{ ...muted, color: "var(--color-danger)" }}>{error}</span>}
    </div>
  )
}

const muted: React.CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-muted)",
}

function btn(bg: string): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 12px",
    borderRadius: 4,
    background: bg,
    color: "#fff",
    border: "0.5px solid var(--color-border-secondary)",
    cursor: "pointer",
  }
}
