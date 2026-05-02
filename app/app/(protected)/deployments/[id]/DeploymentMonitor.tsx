"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

interface TargetRow {
  id: string
  deviceId: string
  stageName: string
  status: string
  attemptCount: number
  exitCode: number | null
  durationMs: number | null
  detectedVersionPre: string | null
  detectedVersionPost: string | null
  stderrTail: string | null
  progressMessage: string | null
  progressPercent: number | null
  startedAt: Date | string | null
  completedAt: Date | string | null
}

interface StageSummary {
  name: string
  abortFailureRate: number
  requiresApproval: boolean
  targets: TargetRow[]
  summary: {
    total: number
    succeeded: number
    failed: number
    noOp: number
    pending: number
    running: number
    rebootDeferred: number
    skipped: number
    isComplete: boolean
    failureRate: number
  }
}

const FILTERS = [
  { key: "all", label: "All", color: "var(--color-text-muted)" },
  { key: "failed", label: "Failed", color: "var(--color-danger)" },
  { key: "running", label: "Running", color: "var(--color-accent)" },
  { key: "pending", label: "Pending", color: "var(--color-text-muted)" },
  { key: "succeeded", label: "Done", color: "var(--color-success)" },
  { key: "reboot-deferred", label: "Reboot deferred", color: "var(--color-warn)" },
] as const

export default function DeploymentMonitor({
  deploymentId,
  stages,
  deviceById,
  isLive,
  isTerminal,
}: {
  deploymentId: string
  stages: StageSummary[]
  deviceById: Record<string, { hostname: string; clientName: string; os: string | null }>
  isLive: boolean
  isTerminal: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [filter, setFilter] = useState<string>("all")
  const [autoRefresh, setAutoRefresh] = useState<boolean>(isLive && !isTerminal)
  const [busy, setBusy] = useState<string | null>(null)

  // Auto-refresh every 3s while live + autoRefresh on.
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => {
      startTransition(() => router.refresh())
    }, 3000)
    return () => clearInterval(id)
  }, [autoRefresh, router])

  const allTargets = useMemo(() => stages.flatMap((s) => s.targets), [stages])
  const filtered = useMemo(() => {
    if (filter === "all") return allTargets
    if (filter === "running") return allTargets.filter((t) => ["dispatched", "running"].includes(t.status))
    return allTargets.filter((t) => t.status === filter)
  }, [allTargets, filter])

  const counts = useMemo(() => {
    const by = (s: string) => allTargets.filter((t) => t.status === s).length
    return {
      all: allTargets.length,
      failed: by("failed"),
      running: allTargets.filter((t) => ["dispatched", "running"].includes(t.status)).length,
      pending: by("pending"),
      succeeded: by("succeeded") + by("no-op"),
      "reboot-deferred": by("reboot-deferred"),
    }
  }, [allTargets])

  async function action(targetId: string, path: string, body?: unknown) {
    setBusy(`${targetId}:${path}`)
    try {
      const res = await fetch(`/api/deployment-targets/${targetId}/${path}`, {
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
    <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>
          Targets · {counts.all} total
        </h2>
        <label style={{ fontSize: 11, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          auto-refresh (3s)
        </label>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 4,
              border: filter === f.key ? `1px solid ${f.color}` : "0.5px solid var(--color-border-tertiary)",
              background: filter === f.key ? f.color : "transparent",
              color: filter === f.key ? "#fff" : f.color,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {f.label} · {counts[f.key as keyof typeof counts] ?? 0}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          No targets matching this filter.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((t) => (
            <TargetRowCard
              key={t.id}
              row={t}
              host={deviceById[t.deviceId]}
              onRetry={() => action(t.id, "retry")}
              onSkip={() => action(t.id, "skip")}
              onSimulate={(outcome) => action(t.id, "_simulate", { outcome })}
              busyToken={busy}
              isTerminal={isTerminal}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function TargetRowCard({
  row,
  host,
  onRetry,
  onSkip,
  onSimulate,
  busyToken,
  isTerminal,
}: {
  row: TargetRow
  host: { hostname: string; clientName: string; os: string | null } | undefined
  onRetry: () => void
  onSkip: () => void
  onSimulate: (outcome: "succeed" | "no-op" | "fail-disk" | "fail-policy" | "reboot-deferred") => void
  busyToken: string | null
  isTerminal: boolean
}) {
  const failed = row.status === "failed"
  const pending = row.status === "pending"
  const running = ["dispatched", "running"].includes(row.status)
  const succeeded = row.status === "succeeded" || row.status === "no-op"
  const dot = failed
    ? "var(--color-danger)"
    : succeeded
      ? "var(--color-success)"
      : row.status === "reboot-deferred"
        ? "var(--color-warn)"
        : running
          ? "var(--color-accent)"
          : "var(--color-text-muted)"

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "10px 12px",
        borderRadius: 6,
        background: "var(--color-background-tertiary)",
        border: "0.5px solid var(--color-border-tertiary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 600, minWidth: 120 }}>
          {host?.hostname ?? "(unknown)"}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 60 }}>
          {row.stageName}
        </span>
        <span style={{ fontSize: 11, color: dot, fontWeight: 600, minWidth: 110 }}>
          {row.status}
          {failed && row.exitCode !== null ? ` · exit ${row.exitCode}` : ""}
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)", flex: 1 }}>
          {row.progressMessage ?? (pending ? "queued" : "")}
        </span>
        {row.completedAt && (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {new Date(row.completedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {failed && row.stderrTail && (
        <pre style={{
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          color: "var(--color-danger)",
          background: "var(--color-background)",
          padding: "8px 10px",
          borderRadius: 4,
          marginTop: 8,
          marginBottom: 0,
          whiteSpace: "pre-wrap",
          maxHeight: 120,
          overflow: "auto",
        }}>
          {row.stderrTail}
        </pre>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {failed && (
          <button onClick={onRetry} disabled={busyToken !== null} style={miniBtn()}>
            {busyToken === `${row.id}:retry` ? "…" : "Retry"}
          </button>
        )}
        {!isTerminal && !succeeded && (
          <button onClick={onSkip} disabled={busyToken !== null} style={miniBtnGhost()}>
            {busyToken === `${row.id}:skip` ? "…" : "Skip"}
          </button>
        )}
        {pending && !isTerminal && (
          <details style={{ display: "inline-block" }}>
            <summary style={{ ...miniBtnGhost(), cursor: "pointer", listStyle: "none", display: "inline-block" }}>
              Simulate ▾
            </summary>
            <div style={{ display: "inline-flex", gap: 4, marginLeft: 6 }}>
              <button onClick={() => onSimulate("succeed")} style={simBtn("var(--color-success)")} disabled={busyToken !== null}>succeed</button>
              <button onClick={() => onSimulate("no-op")} style={simBtn("var(--color-text-muted)")} disabled={busyToken !== null}>no-op</button>
              <button onClick={() => onSimulate("fail-disk")} style={simBtn("var(--color-danger)")} disabled={busyToken !== null}>fail-disk</button>
              <button onClick={() => onSimulate("fail-policy")} style={simBtn("var(--color-danger)")} disabled={busyToken !== null}>fail-policy</button>
              <button onClick={() => onSimulate("reboot-deferred")} style={simBtn("var(--color-warn)")} disabled={busyToken !== null}>reboot-deferred</button>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

function miniBtn(): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 4,
    border: "0.5px solid var(--color-accent)",
    background: "var(--color-accent)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  }
}
function miniBtnGhost(): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 4,
    border: "0.5px solid var(--color-border-tertiary)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  }
}
function simBtn(color: string): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "3px 8px",
    borderRadius: 4,
    border: `0.5px solid ${color}`,
    background: "transparent",
    color,
    cursor: "pointer",
    fontWeight: 600,
  }
}
