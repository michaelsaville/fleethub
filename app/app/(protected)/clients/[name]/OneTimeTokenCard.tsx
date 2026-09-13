"use client"
import { useState } from "react"
import { Card, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 13 WS-D.0 — one-time bootstrap tokens. Since 2026-09-13 this is
// the "Advanced" path under the permanent install link (InstallTab.tsx);
// kept for the paranoid case where a link must not outlive one install.
//
// Operator picks a TTL, clicks "Generate install command", gets two
// one-liners. Token is shown ONCE in this UI.

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

export default function OneTimeTokenCard({ tenantName }: Props) {
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
        <CardHeader title="Advanced: single-use token" />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={TYPOGRAPHY.HINT}>
            For when a link must not outlive one install (contractor
            hand-off, air-gapped site). Expires, single-use by default.
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

    </div>
  )
}
