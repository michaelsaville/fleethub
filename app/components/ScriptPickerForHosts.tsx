"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"

// SA-3 — the /devices BulkBar "Run script…" deep-links to
// /scripts?hosts=<csv>. This is the receiving end: pick a script and
// fan it out across the selected hosts via the deviceIds[] path of
// /api/scripts/[id]/run (which carries the SEC-3 bulk-approval gate).

interface ScriptLite {
  id: string
  name: string
  shell: string
  category: string | null
  isCurated: boolean
}

type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "approval"; approvalId: string; reason?: string }
  | { kind: "done"; count: number; ok: number }
  | { kind: "error"; message: string }

export default function ScriptPickerForHosts({
  scripts,
  deviceIds,
}: {
  scripts: ScriptLite[]
  deviceIds: string[]
}) {
  const router = useRouter()
  const [dryRun, setDryRun] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [state, setState] = useState<Record<string, RunState>>({})

  async function run(scriptId: string) {
    setBusyId(scriptId)
    setState((s) => ({ ...s, [scriptId]: { kind: "running" } }))
    try {
      const res = await fetch(`/api/scripts/${scriptId}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceIds, dryRun }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        status?: string
        approvalId?: string
        reason?: string
        count?: number
        results?: Array<{ ok: boolean }>
        error?: string
      }
      if (res.status === 202 && json.status === "approval-required") {
        setState((s) => ({
          ...s,
          [scriptId]: { kind: "approval", approvalId: json.approvalId ?? "", reason: json.reason },
        }))
      } else if (res.ok) {
        const ok = (json.results ?? []).filter((r) => r.ok).length
        setState((s) => ({
          ...s,
          [scriptId]: { kind: "done", count: json.count ?? deviceIds.length, ok },
        }))
      } else {
        setState((s) => ({
          ...s,
          [scriptId]: { kind: "error", message: json.error ?? `HTTP ${res.status}` },
        }))
      }
    } catch (e) {
      setState((s) => ({
        ...s,
        [scriptId]: { kind: "error", message: e instanceof Error ? e.message : String(e) },
      }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InlineAlert tone="info">
        Running against <strong>{deviceIds.length}</strong> selected host
        {deviceIds.length === 1 ? "" : "s"}. Pick a script below.{" "}
        <a href="/scripts" style={{ textDecoration: "underline" }}>Clear selection</a>
      </InlineAlert>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        Dry-run first (recommended — agent simulates without applying)
      </label>

      <Card padding={0} style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {scripts.map((s) => {
              const st = state[s.id] ?? { kind: "idle" }
              return (
                <tr key={s.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                      {s.shell}{s.category ? ` · ${s.category}` : ""}{s.isCurated ? " · curated" : ""}
                    </div>
                  </td>
                  <td style={{ padding: "10px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {st.kind === "done" ? (
                      <span style={{ fontSize: 12, color: "var(--color-success)" }}>
                        ✓ dispatched {st.ok}/{st.count}
                      </span>
                    ) : st.kind === "approval" ? (
                      <span style={{ fontSize: 12, color: "var(--color-warning, #b45309)" }}>
                        needs approval —{" "}
                        <a href="/approvals" style={{ textDecoration: "underline" }}>review</a>
                      </span>
                    ) : st.kind === "error" ? (
                      <span style={{ fontSize: 12, color: "var(--color-danger, #dc2626)" }}>{st.message}</span>
                    ) : (
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={() => run(s.id)}
                        disabled={busyId !== null}
                      >
                        {st.kind === "running" ? "running…" : dryRun ? "Dry-run" : "Run"}
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <div>
        <Button variant="ghost" size="xs" onClick={() => router.refresh()}>refresh</Button>
      </div>
    </div>
  )
}
