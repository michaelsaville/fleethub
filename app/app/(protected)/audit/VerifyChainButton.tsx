"use client"

import { useState } from "react"

interface VerifyResult {
  totalRows: number
  verifiedRows: number
  intact: boolean
  brokenAt: { id: string; index: number; createdAt: string; reason: string } | null
  hashLast: string | null
  checkedAt: string
}

export default function VerifyChainButton() {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VerifyResult | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/audit/verify", { cache: "no-store" })
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        return
      }
      const json = (await res.json()) as VerifyResult
      setResult(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px", minWidth: "220px" }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{
          fontSize: "12px",
          fontWeight: 500,
          padding: "7px 14px",
          borderRadius: "6px",
          border: "0.5px solid var(--color-border-tertiary)",
          background: busy ? "var(--color-background-tertiary)" : "var(--color-background-secondary)",
          color: "var(--color-text-primary)",
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "Verifying chain…" : "Verify chain integrity"}
      </button>
      {error && (
        <span style={{ fontSize: "11px", color: "var(--color-danger)" }}>
          {error}
        </span>
      )}
      {result && (
        <div
          style={{
            fontSize: "11px",
            color: result.intact ? "var(--color-success)" : "var(--color-danger)",
            textAlign: "right",
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          {result.intact
            ? `✓ ${result.verifiedRows.toLocaleString()} rows verified`
            : `✗ broken at row #${result.brokenAt?.index} (${result.brokenAt?.reason})`}
          <div style={{ fontSize: "10px", color: "var(--color-text-muted)", fontWeight: 400, marginTop: "2px" }}>
            {new Date(result.checkedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  )
}
