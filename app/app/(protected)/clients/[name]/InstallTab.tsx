"use client"
import { useCallback, useEffect, useState } from "react"
import { Card, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import OneTimeTokenCard from "./OneTimeTokenCard"

// Deploy-on-the-fly (2026-09-13). The client's permanent install link:
// one download (double-click installer), two one-liners, and the list of
// what enrolled recently. Nothing expires, nothing is shown "once" — a
// tech standing at a desk opens this tab on their phone and reads the
// line out. Rotate kills every old link instantly.

interface Props {
  tenantName: string
}

interface KeyState {
  tenantName: string
  key: string | null
  enabled: boolean
  rotatedAt: string | null
  links: {
    windowsOneLiner: string
    unixOneLiner: string
    windowsInstallerUrl: string
    windowsInstallerName: string
    scriptPs1Url: string
    scriptShUrl: string
  } | null
  recent: Array<{
    id: string
    hostname: string | null
    os: string | null
    enrolledAt: string
    lastSeenAt: string | null
    isRevoked: boolean
    viaKey: boolean
  }>
}

const PRE: React.CSSProperties = {
  background: "var(--color-background-tertiary)",
  padding: "10px 12px",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  margin: 0,
  border: "0.5px solid var(--color-border-tertiary)",
  flex: 1,
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* select manually */
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={TYPOGRAPHY.LABEL_CAPS}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <pre style={PRE}>{value}</pre>
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </Button>
      </div>
      <div style={TYPOGRAPHY.HINT}>{hint}</div>
    </div>
  )
}

export default function InstallTab({ tenantName }: Props) {
  const [state, setState] = useState<KeyState | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/enroll-key?tenantName=${encodeURIComponent(tenantName)}`)
    if (!res.ok) {
      setErr(`HTTP ${res.status}`)
      return
    }
    setState((await res.json()) as KeyState)
  }, [tenantName])

  useEffect(() => {
    void load()
  }, [load])

  async function act(action: "ensure" | "rotate" | "disable" | "enable") {
    if (action === "rotate" && !confirm("Rotate the install link? Every copy of the old link and installer stops working immediately. Machines already enrolled are unaffected.")) return
    setPending(true)
    setErr(null)
    try {
      const res = await fetch("/api/admin/enroll-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantName, action }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(j.error ?? `HTTP ${res.status}`)
        return
      }
      setState((await res.json()) as KeyState)
    } finally {
      setPending(false)
    }
  }

  const rel = (iso: string | null) => {
    if (!iso) return "never"
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (m < 1) return "just now"
    if (m < 60) return `${m} min ago`
    if (m < 60 * 48) return `${Math.round(m / 60)} h ago`
    return new Date(iso).toLocaleDateString()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
      <Card>
        <CardHeader title={`Add a computer to ${tenantName}`} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {err && <InlineAlert tone="danger">{err}</InlineAlert>}

          {state && !state.key && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={TYPOGRAPHY.HINT}>
                This client has no install link yet. Create one — it never expires and works for any number of
                machines until you rotate it.
              </div>
              <div>
                <Button variant="primary" onClick={() => act("ensure")} disabled={pending}>
                  {pending ? "Creating…" : "Create install link"}
                </Button>
              </div>
            </div>
          )}

          {state?.key && state.links && (
            <>
              {!state.enabled && (
                <InlineAlert tone="warn">
                  Install link is <b>disabled</b> — downloads and scripts return 404 until you enable it.
                </InlineAlert>
              )}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                  padding: 12,
                  border: "0.5px solid var(--color-border-tertiary)",
                  borderRadius: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 600 }}>Windows installer</div>
                  <div style={TYPOGRAPHY.HINT}>
                    Download, double-click, click Yes on the UAC prompt. It installs the service, enrolls this
                    client, and shows a confirmation. Re-running on an already-enrolled machine re-enrolls it
                    cleanly. <b>Keep the filename</b> — the client key is carried in it.
                  </div>
                </div>
                <a href={state.links.windowsInstallerUrl} download={state.links.windowsInstallerName}>
                  <Button variant="primary">Download pcc2k-agent-…exe</Button>
                </a>
              </div>

              <CopyRow
                label="Windows one-liner (any PowerShell — self-elevates)"
                value={state.links.windowsOneLiner}
                hint="Paste into PowerShell, Syncro/Intune script, or a run-as-admin prompt. Verifies the binary's sha256 against the manifest before running it."
              />
              <CopyRow
                label="Linux / macOS one-liner"
                value={state.links.unixOneLiner}
                hint="Installs to /usr/local/bin and registers a systemd unit (launchd on macOS)."
              />

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={TYPOGRAPHY.HINT}>
                  Key <code>{state.key.slice(0, 8)}…</code>
                  {state.rotatedAt ? ` · created ${new Date(state.rotatedAt).toLocaleDateString()}` : ""}
                </span>
                <span style={{ flex: 1 }} />
                {state.enabled ? (
                  <Button variant="ghost" onClick={() => act("disable")} disabled={pending}>
                    Disable link
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => act("enable")} disabled={pending}>
                    Enable link
                  </Button>
                )}
                <Button variant="ghost" onClick={() => act("rotate")} disabled={pending}>
                  Rotate (invalidate old links)
                </Button>
              </div>
            </>
          )}

          {!state && !err && <div style={TYPOGRAPHY.HINT}>Loading…</div>}
        </div>
      </Card>

      {state && state.recent.length > 0 && (
        <Card>
          <CardHeader title="Recently enrolled" />
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-secondary)" }}>
                <th style={{ padding: "4px 6px" }}>Host</th>
                <th style={{ padding: "4px 6px" }}>OS</th>
                <th style={{ padding: "4px 6px" }}>Enrolled</th>
                <th style={{ padding: "4px 6px" }}>Last seen</th>
                <th style={{ padding: "4px 6px" }}>Via</th>
              </tr>
            </thead>
            <tbody>
              {state.recent.map((r) => (
                <tr key={r.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)", opacity: r.isRevoked ? 0.5 : 1 }}>
                  <td style={{ padding: "6px" }}>
                    {r.hostname ?? "—"}
                    {r.isRevoked ? " (revoked)" : ""}
                  </td>
                  <td style={{ padding: "6px" }}>{r.os ?? "—"}</td>
                  <td style={{ padding: "6px" }}>{rel(r.enrolledAt)}</td>
                  <td style={{ padding: "6px" }}>{rel(r.lastSeenAt)}</td>
                  <td style={{ padding: "6px" }}>{r.viaKey ? "install link" : "one-time token"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div>
        <Button variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "Hide advanced" : "Advanced: single-use token…"}
        </Button>
      </div>
      {showAdvanced && <OneTimeTokenCard tenantName={tenantName} />}
    </div>
  )
}
