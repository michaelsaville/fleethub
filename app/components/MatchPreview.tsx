"use client"
import { useEffect, useState } from "react"
import { TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 9 WS-A §3.5 — live match-preview pane shared by
// AlertRouteForm / RunbookForm / MonitorForm.
//
// Posts { severity, kindLike } to /api/admin/match-preview on
// debounced change, renders "N alerts matched in last 7d + 3
// samples." Closes the silent-typo failure mode: operator who
// writes `kindLike=disk.*` learns immediately whether real
// alerts match the glob, not weeks later when the rule didn't
// fire.

interface Props {
  severity?: string[]
  kindLike?: string
}

interface PreviewResult {
  matchCount: number
  examined: number
  windowDays: number
  samples: Array<{
    id: string
    kind: string
    severity: string
    title: string
    firedAt: string
    clientName: string
  }>
  truncated: boolean
}

export function MatchPreview({ severity, kindLike }: Props) {
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sevKey = (severity ?? []).slice().sort().join(",")
  const kindKey = (kindLike ?? "").trim()

  useEffect(() => {
    // Debounce 400ms so typing kindLike doesn't fire every keystroke.
    const t = setTimeout(async () => {
      if (!sevKey && !kindKey) {
        setResult(null)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/admin/match-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ severity, kindLike }),
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = (await res.json()) as PreviewResult
        setResult(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : "preview failed")
        setResult(null)
      } finally {
        setLoading(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [sevKey, kindKey, severity, kindLike])

  if (!sevKey && !kindKey) {
    return (
      <div style={{ ...TYPOGRAPHY.HINT, marginTop: 8 }}>
        Add a severity or kind glob to see preview.
      </div>
    )
  }
  if (loading && !result) {
    return (
      <div style={{ ...TYPOGRAPHY.HINT, marginTop: 8 }}>Checking recent alerts…</div>
    )
  }
  if (error) {
    return (
      <div style={{ ...TYPOGRAPHY.HINT, marginTop: 8, color: "var(--color-danger)" }}>
        Preview failed: {error}
      </div>
    )
  }
  if (!result) return null

  const tone = result.matchCount > 0 ? "var(--color-success)" : "var(--color-warning)"
  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 10px",
        background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))",
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <div>
        Would have matched{" "}
        <strong style={{ color: tone }}>{result.matchCount}</strong>{" "}
        alert{result.matchCount === 1 ? "" : "s"} in the last {result.windowDays} days
        {result.truncated && " (showing first 500)"}.
      </div>
      {result.samples.length > 0 && (
        <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "var(--color-text-secondary)" }}>
          {result.samples.map((s) => (
            <li key={s.id} style={{ fontSize: 11.5 }}>
              <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{s.kind}</code>{" "}
              · {s.severity} · {s.clientName} · {s.title.length > 60 ? s.title.slice(0, 57) + "…" : s.title}
            </li>
          ))}
        </ul>
      )}
      {result.matchCount === 0 && result.examined > 0 && (
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
          Examined {result.examined} alerts. Double-check the kind glob — wildcards use `*` (e.g. `disk.*`).
        </div>
      )}
    </div>
  )
}
