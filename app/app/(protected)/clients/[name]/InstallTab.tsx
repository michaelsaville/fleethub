"use client"
import { useState } from "react"
import { Card, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 13 WS-D.0 — deploy-from-panel UI.
//
// Operator picks a TTL, clicks "Generate install command", gets two
// one-liners (Unix curl-pipe-bash and Windows iwr-pipe-iex). Token
// is shown ONCE in this UI; if the page reloads, the operator has to
// generate a new one. Matches the Phase-11 recovery-code reveal
// pattern.

interface Props {
  tenantName: string
}

interface TokenResp {
  token: string
  expiresAt: string
  maxUses: number
  bootstrapSnippetUnix: string
  bootstrapSnippetWindows: string
}

export default function InstallTab({ tenantName }: Props) {
  const [ttlHours, setTtlHours] = useState(24)
  const [maxUses, setMaxUses] = useState(1)
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [issued, setIssued] = useState<TokenResp | null>(null)
  const [tab, setTab] = useState<"unix" | "windows">("unix")
  const [copied, setCopied] = useState(false)

  async function generate() {
    setPending(true)
    setErr(null)
    try {
      const res = await fetch("/api/admin/enroll-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantName, ttlHours, maxUses }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(j.error ?? `HTTP ${res.status}`)
        return
      }
      setIssued((await res.json()) as TokenResp)
    } finally {
      setPending(false)
    }
  }

  async function copy() {
    if (!issued) return
    const snippet = tab === "unix" ? issued.bootstrapSnippetUnix : issued.bootstrapSnippetWindows
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setErr("Clipboard API blocked — select + copy manually")
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <Card>
        <CardHeader title={`Install agent on ${tenantName}`} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={TYPOGRAPHY.HINT}>
            Generate a one-time bootstrap token. Paste the snippet on the
            target host. The agent downloads, enrolls, and reports back —
            the host appears in /devices within seconds of first poll.
          </div>

          {!issued && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ ...TYPOGRAPHY.LABEL_CAPS }}>Token TTL (hours)</span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={ttlHours}
                  onChange={(e) => setTtlHours(Number(e.target.value))}
                  style={{ ...FIELD, width: 100 }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ ...TYPOGRAPHY.LABEL_CAPS }}>Max uses</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value))}
                  style={{ ...FIELD, width: 100 }}
                />
                <span style={TYPOGRAPHY.HINT}>
                  1 = single-use. Raise for bulk onboarding (push the same
                  snippet across N hosts). Capped at 200.
                </span>
              </label>
              <div>
                <Button variant="primary" onClick={generate} disabled={pending}>
                  {pending ? "Generating…" : "Generate install command"}
                </Button>
              </div>
            </div>
          )}

          {err && <InlineAlert tone="danger">{err}</InlineAlert>}

          {issued && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <InlineAlert tone="warn">
                Token shown ONCE — copy now. Expires{" "}
                {new Date(issued.expiresAt).toLocaleString()}.{" "}
                {issued.maxUses > 1
                  ? `Good for up to ${issued.maxUses} enrollments, then it's spent. After expiry or once exhausted, generate a new token.`
                  : "After expiry or on first successful use, generate a new token."}
              </InlineAlert>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setTab("unix")}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: tab === "unix" ? 600 : 400,
                    background: tab === "unix" ? "var(--color-accent)" : "transparent",
                    color: tab === "unix" ? "#fff" : "var(--color-text-secondary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Linux / macOS
                </button>
                <button
                  type="button"
                  onClick={() => setTab("windows")}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: tab === "windows" ? 600 : 400,
                    background: tab === "windows" ? "var(--color-accent)" : "transparent",
                    color: tab === "windows" ? "#fff" : "var(--color-text-secondary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Windows
                </button>
                <span style={{ flex: 1 }} />
                <Button variant="secondary" onClick={copy}>
                  {copied ? "Copied ✓" : "Copy"}
                </Button>
              </div>

              <pre
                style={{
                  background: "var(--color-background-tertiary)",
                  padding: "12px 14px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  margin: 0,
                  border: "0.5px solid var(--color-border-tertiary)",
                }}
              >
                {tab === "unix" ? issued.bootstrapSnippetUnix : issued.bootstrapSnippetWindows}
              </pre>

              <div style={{ ...TYPOGRAPHY.HINT, paddingTop: 4 }}>
                {tab === "unix"
                  ? "Run as a user with sudo. The script installs to /usr/local/bin and registers a systemd unit."
                  : "Run in an Administrator PowerShell. The script installs to C:\\Program Files\\pcc2k-agent and registers a Windows service."}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <Button variant="ghost" onClick={() => { setIssued(null); setCopied(false) }}>
                  Generate another
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Manual / advanced enrollment" />
        <div style={TYPOGRAPHY.HINT}>
          For air-gapped deployments or operators who prefer not to pipe
          curl into bash:
          <ol style={{ marginTop: 8, paddingLeft: 18 }}>
            <li>Generate a token above.</li>
            <li>
              Download the binary from{" "}
              <code>/install/pcc2k-agent-{"<platform>"}</code> (linux-amd64,
              linux-arm64, darwin-amd64, darwin-arm64, windows-amd64).
            </li>
            <li>
              Run:{" "}
              <code>
                pcc2k-agent --bootstrap-token &lt;token&gt; --bootstrap-url
                &lt;fleethub-url&gt;
              </code>
            </li>
            <li>
              Agent prints the per-host secret + agent id on stdout for the
              operator's records, then exits. Subsequent invocations use
              the stored secret automatically (systemd / NSSM service unit).
            </li>
          </ol>
        </div>
      </Card>
    </div>
  )
}
