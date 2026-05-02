"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

export default function RunMonitor({
  runId,
  state,
  isLive,
  isAdmin,
  stdout,
  stderr,
  exitCode,
  durationMs,
  rejectReason,
  startedAt,
  finishedAt,
  createdAt,
  stateColor,
  args,
  env,
  interpreter,
}: {
  runId: string
  state: string
  isLive: boolean
  isAdmin: boolean
  stdout: string | null
  stderr: string | null
  exitCode: number | null
  durationMs: number | null
  rejectReason: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  stateColor: string
  args: string[] | null
  env: Record<string, string> | null
  interpreter: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [follow, setFollow] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(isLive)
  const [busy, setBusy] = useState<string | null>(null)

  // Auto-refresh while live + autoRefresh on.
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => {
      startTransition(() => router.refresh())
    }, 2500)
    return () => clearInterval(id)
  }, [autoRefresh, router])

  // Auto-scroll to bottom of stdout when follow is on + new content arrives.
  useEffect(() => {
    if (!follow) return
    const out = document.getElementById(`stdout-${runId}`)
    const err = document.getElementById(`stderr-${runId}`)
    if (out) out.scrollTop = out.scrollHeight
    if (err) err.scrollTop = err.scrollHeight
  }, [stdout, stderr, follow, runId])

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

  return (
    <>
      {/* State strip */}
      <section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "10px 14px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: stateColor }} />
            <strong style={{ color: stateColor, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.06em" }}>{state}</strong>
          </span>
          {exitCode !== null && (
            <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
              exit <strong style={{ color: exitCode === 0 ? "var(--color-success)" : "var(--color-danger)" }}>{exitCode}</strong>
            </span>
          )}
          {durationMs !== null && (
            <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
              {(durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {rejectReason && (
            <span style={{ color: "var(--color-danger)", fontSize: 12 }}>
              rejected: {rejectReason}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isLive && (
            <>
              <label style={{ fontSize: 11, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                auto-refresh
              </label>
              <button
                onClick={() => {
                  if (confirm("Cancel this run?")) call(`/api/script-runs/${runId}/cancel`)
                }}
                disabled={busy !== null}
                style={btnDanger()}
              >
                {busy?.endsWith("/cancel") ? "…" : "Cancel run"}
              </button>
            </>
          )}
          <label style={{ fontSize: 11, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            follow tail
          </label>
        </div>
      </section>

      {/* Mock simulation panel — visible only while live + admin */}
      {isLive && isAdmin && (
        <section style={{ padding: "10px 14px", background: "var(--color-background-secondary)", border: "0.5px dashed var(--color-warn)", borderRadius: 10, fontSize: 12 }}>
          <div style={{ color: "var(--color-warn)", fontWeight: 600, marginBottom: 6 }}>
            Mock-mode simulation (real agent dispatch not wired yet — Phase 2 step 4)
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => call(`/api/script-runs/${runId}/_simulate`, { outcome: "ok" })} disabled={busy !== null} style={simBtn("var(--color-success)")}>simulate ok</button>
            <button onClick={() => call(`/api/script-runs/${runId}/_simulate`, { outcome: "error" })} disabled={busy !== null} style={simBtn("var(--color-danger)")}>simulate error</button>
            <button onClick={() => call(`/api/script-runs/${runId}/_simulate`, { outcome: "timeout" })} disabled={busy !== null} style={simBtn("var(--color-warn)")}>simulate timeout</button>
          </div>
        </section>
      )}

      {/* Output panes */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <OutputPane title="stdout" id={`stdout-${runId}`} body={stdout} placeholder={isLive ? "(awaiting agent…)" : "(no stdout)"} />
        <OutputPane title="stderr" id={`stderr-${runId}`} body={stderr} placeholder={isLive ? "(awaiting agent…)" : "(no stderr)"} accent="var(--color-danger)" />
      </section>

      {/* Dispatch metadata */}
      <section style={{ padding: 14, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
        <h2 style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0, marginBottom: 10 }}>
          Dispatch
        </h2>
        <table style={{ fontSize: 12, borderCollapse: "collapse" }}>
          <tbody>
            <Row label="Run id" value={runId} mono />
            <Row label="Interpreter" value={interpreter} />
            <Row label="Created" value={fmt(createdAt)} />
            <Row label="Started" value={startedAt ? fmt(startedAt) : "—"} />
            <Row label="Finished" value={finishedAt ? fmt(finishedAt) : "—"} />
            <Row label="Args" value={args && args.length > 0 ? args.join(" ") : "—"} mono />
            <Row label="Env" value={env && Object.keys(env).length > 0 ? Object.entries(env).map(([k, v]) => `${k}=${v}`).join(", ") : "—"} mono />
          </tbody>
        </table>
      </section>
    </>
  )
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString()
}

function OutputPane({
  title,
  id,
  body,
  placeholder,
  accent,
}: {
  title: string
  id: string
  body: string | null
  placeholder: string
  accent?: string
}) {
  return (
    <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 320 }}>
      <div style={{ padding: "8px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 11, fontWeight: 600, color: accent ?? "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {title}
      </div>
      <pre
        id={id}
        style={{
          flex: 1,
          margin: 0,
          padding: 12,
          fontSize: 11.5,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          color: "var(--color-text-primary)",
          background: "var(--color-background)",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 480,
        }}
      >
        {body && body.length > 0 ? body : <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>{placeholder}</span>}
      </pre>
    </section>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "4px 12px 4px 0", color: "var(--color-text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, verticalAlign: "top" }}>{label}</td>
      <td style={{ padding: "4px 0", fontFamily: mono ? "ui-monospace, SFMono-Regular, monospace" : undefined, wordBreak: "break-all" }}>{value}</td>
    </tr>
  )
}

function btnDanger(): React.CSSProperties {
  return { fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "0.5px solid var(--color-danger)", background: "transparent", color: "var(--color-danger)", cursor: "pointer", fontWeight: 600 }
}

function simBtn(color: string): React.CSSProperties {
  return { fontSize: 11, padding: "5px 10px", borderRadius: 4, border: `0.5px solid ${color}`, background: "transparent", color, cursor: "pointer", fontWeight: 600 }
}
