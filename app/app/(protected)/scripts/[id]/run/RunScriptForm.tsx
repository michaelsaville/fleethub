"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"

interface ScriptOpt {
  id: string
  name: string
  shell: string
  dryRunCapable: boolean
  requiresSignature: boolean
}

interface DeviceOpt {
  id: string
  hostname: string
  clientName: string
  os: string | null
  role: string | null
  isOnline: boolean
  maintenanceMode: boolean
}

export default function RunScriptForm({
  script,
  devices,
  defaultDeviceId,
}: {
  script: ScriptOpt
  devices: DeviceOpt[]
  defaultDeviceId: string | null
}) {
  const router = useRouter()
  const [deviceId, setDeviceId] = useState(defaultDeviceId ?? "")
  const [dryRun, setDryRun] = useState(true)
  const [args, setArgs] = useState("")
  const [env, setEnv] = useState("")
  const [filter, setFilter] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingApply, setConfirmingApply] = useState(false)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return devices
    return devices.filter(
      (d) =>
        d.hostname.toLowerCase().includes(q) ||
        d.clientName.toLowerCase().includes(q) ||
        (d.role ?? "").toLowerCase().includes(q),
    )
  }, [devices, filter])

  const selected = devices.find((d) => d.id === deviceId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!deviceId) {
      setError("Pick a target host")
      return
    }
    if (!dryRun && !confirmingApply) {
      setConfirmingApply(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/scripts/${script.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          dryRun,
          args: args.trim() ? args.split(/\s+/) : undefined,
          env: env.trim() ? parseEnvLines(env) : undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const run = (await res.json()) as { id: string }
      router.push(`/runs/${run.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card title={`Target host${selected ? ` — ${selected.hostname}` : ""}`}>
        <input
          type="search"
          placeholder="Filter by hostname, client, or role…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ ...input(), marginBottom: 8 }}
        />
        <div style={{ maxHeight: 280, overflow: "auto", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--color-background-tertiary)" }}>
                <th style={{ ...th(), width: 30 }}></th>
                <th style={th()}>Hostname</th>
                <th style={th()}>Client</th>
                <th style={th()}>OS</th>
                <th style={th()}>State</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  style={{
                    borderTop: "0.5px solid var(--color-border-tertiary)",
                    background: deviceId === d.id ? "var(--color-background-tertiary)" : "transparent",
                    cursor: d.maintenanceMode ? "not-allowed" : "pointer",
                    opacity: d.maintenanceMode ? 0.6 : 1,
                  }}
                  onClick={() => !d.maintenanceMode && setDeviceId(d.id)}
                  title={d.maintenanceMode ? "Host is in Maintenance Mode — dispatch will be rejected" : undefined}
                >
                  <td style={td()}>
                    <input
                      type="radio"
                      name="device"
                      checked={deviceId === d.id}
                      disabled={d.maintenanceMode}
                      readOnly
                    />
                  </td>
                  <td style={td()}>{d.hostname}</td>
                  <td style={td()}>{d.clientName}</td>
                  <td style={td()}>{d.os ?? "—"}</td>
                  <td style={td()}>
                    {d.maintenanceMode && <span style={{ color: "var(--color-warn)", fontWeight: 600 }}>🔒 maintenance</span>}
                    {!d.maintenanceMode && d.isOnline && <span style={{ color: "var(--color-success)" }}>online</span>}
                    {!d.maintenanceMode && !d.isOnline && <span style={{ color: "var(--color-text-muted)" }}>offline</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Execution mode">
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, padding: "6px 0" }}>
          <input
            type="checkbox"
            checked={dryRun}
            disabled={!script.dryRunCapable}
            onChange={(e) => {
              setDryRun(e.target.checked)
              setConfirmingApply(false)
            }}
          />
          <span>
            Dry run
            {!script.dryRunCapable && (
              <span style={{ color: "var(--color-warn)", fontSize: 11, marginLeft: 8 }}>
                (script not dry-run capable — will run in apply mode)
              </span>
            )}
          </span>
        </label>
        {!dryRun && (
          <p style={{ fontSize: 11, color: "var(--color-warn)", marginTop: 4 }}>
            ⚠ Apply mode — script will execute against the target. The submit button will require an extra click to confirm.
          </p>
        )}
      </Card>

      <Card title="Args + env (optional)">
        <Field label="Args (space-separated)">
          <input
            type="text"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder='--days 30 --verbose'
            style={input()}
          />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Env (KEY=value, one per line)">
          <textarea
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            placeholder='LOG_LEVEL=info&#10;CLIENT_NAME=Acme'
            rows={3}
            style={{ ...input(), fontFamily: "ui-monospace, SFMono-Regular, monospace", resize: "vertical" }}
          />
        </Field>
      </Card>

      {error && <p style={{ color: "var(--color-danger)", fontSize: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {confirmingApply && (
          <span style={{ fontSize: 12, color: "var(--color-warn)", fontWeight: 600, marginRight: 6 }}>
            Click again to confirm apply →
          </span>
        )}
        <button
          type="button"
          onClick={() => router.push(`/scripts/${script.id}`)}
          style={btnGhost()}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !deviceId}
          style={dryRun ? btnPrimary() : btnDanger()}
        >
          {busy
            ? "Dispatching…"
            : dryRun
              ? "Run dry-run"
              : confirmingApply
                ? "Confirm apply →"
                : "Apply"}
        </button>
      </div>
    </form>
  )
}

function parseEnvLines(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of s.split(/\n+/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
      <div style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}
function input(): React.CSSProperties {
  return { fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background)", color: "var(--color-text-primary)", width: "100%" }
}
function btnPrimary(): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: "8px 16px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-accent)", color: "#fff", cursor: "pointer" }
}
function btnDanger(): React.CSSProperties {
  return { ...btnPrimary(), background: "var(--color-danger)", border: "0.5px solid var(--color-danger)" }
}
function btnGhost(): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: "8px 14px", borderRadius: 6, border: "0.5px solid var(--color-border-tertiary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }
}
function th(): React.CSSProperties {
  return { textAlign: "left", padding: "6px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "6px 10px", color: "var(--color-text-primary)", verticalAlign: "middle" }
}
