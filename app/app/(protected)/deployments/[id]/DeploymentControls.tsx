"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

export default function DeploymentControls({
  deploymentId,
  status,
  currentStage,
  canPromote,
}: {
  deploymentId: string
  status: string
  currentStage: string | null
  canPromote: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function call(path: string, body?: unknown) {
    setBusy(path)
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        alert(data.error || `HTTP ${res.status}`)
      }
      startTransition(() => router.refresh())
    } finally {
      setBusy(null)
    }
  }

  const isRunning = status === "running"
  const isPaused = status === "paused" || status === "auto-paused"
  const isTerminal = ["completed", "aborted"].includes(status)
  if (isTerminal) {
    return (
      <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
        Deployment {status}. Use “Re-run all failed” to retry per-target if needed.
      </div>
    )
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {isRunning && (
        <button
          onClick={() => call(`/api/deployments/${deploymentId}/pause`, { reason: "operator-paused" })}
          disabled={busy !== null}
          style={btn()}
        >
          {busy?.endsWith("/pause") ? "…" : "⏸ Pause"}
        </button>
      )}
      {isPaused && (
        <button
          onClick={() => call(`/api/deployments/${deploymentId}/resume`)}
          disabled={busy !== null}
          style={btnPrimary()}
        >
          {busy?.endsWith("/resume") ? "…" : "▶ Resume"}
        </button>
      )}
      {canPromote && (
        <button
          onClick={() => call(`/api/deployments/${deploymentId}/promote`)}
          disabled={busy !== null}
          style={btnPrimary()}
        >
          {busy?.endsWith("/promote") ? "…" : `⏭ Promote past ${currentStage ?? ""}`}
        </button>
      )}
      <button
        onClick={() => {
          if (confirm("Abort this deployment? Pending targets will be skipped.")) {
            call(`/api/deployments/${deploymentId}/abort`)
          }
        }}
        disabled={busy !== null}
        style={btnDanger()}
      >
        {busy?.endsWith("/abort") ? "…" : "✋ Abort"}
      </button>
    </div>
  )
}

function btn(): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 500,
    padding: "8px 14px",
    borderRadius: 6,
    border: "0.5px solid var(--color-border-tertiary)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  }
}
function btnPrimary(): React.CSSProperties {
  return {
    ...btn(),
    background: "var(--color-accent)",
    color: "#fff",
    border: "0.5px solid var(--color-border-secondary)",
  }
}
function btnDanger(): React.CSSProperties {
  return {
    ...btn(),
    color: "var(--color-danger)",
    border: "0.5px solid var(--color-danger)",
  }
}
