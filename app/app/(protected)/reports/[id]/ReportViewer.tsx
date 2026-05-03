"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type ReportState = "queued" | "generating" | "ready" | "delivered" | "failed" | "expired"

export default function ReportViewer({
  reportId,
  initialState,
  autorun,
}: {
  reportId: string
  initialState: string
  autorun: boolean
}) {
  const router = useRouter()
  const [state, setState] = useState<ReportState>(initialState as ReportState)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (autorun && !running && state === "queued") {
      void runGenerate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runGenerate() {
    setRunning(true)
    setError(null)
    setState("generating")
    try {
      const res = await fetch(`/api/reports/${reportId}/generate`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "Generation failed")
        setState("failed")
        return
      }
      setState(json.state as ReportState)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState("failed")
    } finally {
      setRunning(false)
    }
  }

  return (
    <section
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 3,
              background: stateColor(state),
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {state}
          </span>
          {state === "generating" && (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              Rendering PDF…
            </span>
          )}
          {error && (
            <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(state === "queued" || state === "failed") && (
            <button
              onClick={runGenerate}
              disabled={running}
              style={btnPrimary(running)}
            >
              {state === "failed" ? "Retry" : "Generate now"}
            </button>
          )}
          {(state === "ready" || state === "delivered") && (
            <a
              href={`/api/reports/${reportId}/download`}
              target="_blank"
              rel="noreferrer"
              style={btnPrimary(false)}
            >
              Download PDF →
            </a>
          )}
        </div>
      </div>
      {(state === "ready" || state === "delivered") && (
        <iframe
          src={`/api/reports/${reportId}/download`}
          style={{ width: "100%", height: 720, border: "none", display: "block" }}
          title="Report preview"
        />
      )}
    </section>
  )
}

function stateColor(state: string): string {
  if (state === "ready" || state === "delivered") return "var(--color-success)"
  if (state === "queued" || state === "generating") return "var(--color-warning)"
  if (state === "failed") return "var(--color-danger)"
  return "var(--color-text-muted)"
}

function btnPrimary(running: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: 6,
    background: "var(--color-accent)",
    color: "#fff",
    textDecoration: "none",
    border: "0.5px solid var(--color-border-secondary)",
    cursor: running ? "wait" : "pointer",
    opacity: running ? 0.6 : 1,
  }
}
