"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 9 WS-B §4.6 — MFA enrollment + disable card for a staff user.
// ADMIN-only surface. Recovery codes are shown ONCE post-enrollment;
// operator captures them or regenerates.

interface Props {
  staffId: string
  email: string
  totpEnabledAt: string | null
}

interface EnrollResp {
  secret: string
  qrDataUrl: string
  otpauthUrl: string
}

export default function MfaCard({ staffId, email, totpEnabledAt }: Props) {
  const router = useRouter()
  const [enrollData, setEnrollData] = useState<EnrollResp | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [pending, startTransition] = useTransition()

  const [disableMode, setDisableMode] = useState(false)
  const [disableToken, setDisableToken] = useState("")
  const [disableRecovery, setDisableRecovery] = useState("")

  async function startEnroll() {
    setError(null)
    setRecoveryCodes(null)
    const res = await fetch(`/api/admin/staff/${staffId}/mfa/enroll`, { method: "POST" })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    setEnrollData((await res.json()) as EnrollResp)
  }

  async function verifyEnroll() {
    setError(null)
    const res = await fetch(`/api/admin/staff/${staffId}/mfa/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: code }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    const data = (await res.json()) as { recoveryCodes: string[] }
    setRecoveryCodes(data.recoveryCodes)
    setEnrollData(null)
    setCode("")
    startTransition(() => router.refresh())
  }

  async function disable() {
    setError(null)
    const res = await fetch(`/api/admin/staff/${staffId}/mfa/disable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: disableToken || undefined,
        recoveryCode: disableRecovery || undefined,
      }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    setDisableMode(false)
    setDisableToken("")
    setDisableRecovery("")
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader title="Two-factor authentication" />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {totpEnabledAt ? (
          <>
            <div style={{ fontSize: 13 }}>
              ✓ Enrolled <span style={{ color: "var(--color-text-muted)" }}>{new Date(totpEnabledAt).toLocaleString()}</span>
            </div>
            {!disableMode ? (
              <div>
                <Button variant="danger" onClick={() => setDisableMode(true)} disabled={pending}>
                  Disable MFA
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={TYPOGRAPHY.HINT}>
                  Prove possession with a current 6-digit code <em>or</em> a recovery code:
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={disableToken}
                  onChange={(e) => setDisableToken(e.target.value)}
                  style={{ ...FIELD, width: 220, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                />
                <input
                  type="text"
                  placeholder="recovery code (e.g. A1B2C3D4)"
                  value={disableRecovery}
                  onChange={(e) => setDisableRecovery(e.target.value)}
                  style={{ ...FIELD, width: 280, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="danger" onClick={disable} disabled={pending}>Confirm disable</Button>
                  <Button variant="secondary" onClick={() => setDisableMode(false)} disabled={pending}>Cancel</Button>
                </div>
              </div>
            )}
          </>
        ) : enrollData ? (
          <>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              Scan the QR code with an authenticator app (1Password, Authy, Google
              Authenticator, …) for <strong>{email}</strong>, then enter the first 6-digit code:
            </div>
            <img src={enrollData.qrDataUrl} alt="MFA QR code" width={220} height={220} style={{ background: "#fff", padding: 8, borderRadius: 6 }} />
            <details style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
              <summary style={{ cursor: "pointer" }}>Can&apos;t scan? Show the secret</summary>
              <code style={{ display: "block", marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, monospace", wordBreak: "break-all" }}>
                {enrollData.secret}
              </code>
            </details>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={{ ...FIELD, width: 140, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
              />
              <Button variant="primary" onClick={verifyEnroll} disabled={pending || code.length !== 6}>
                Confirm
              </Button>
              <Button variant="secondary" onClick={() => setEnrollData(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </>
        ) : recoveryCodes ? (
          <>
            <InlineAlert tone="warn">
              MFA enrolled. Save these recovery codes now — they will not be shown
              again. Each works exactly once.
            </InlineAlert>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, padding: "8px 10px", background: "var(--color-background-tertiary)", borderRadius: 6, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 13 }}>
              {recoveryCodes.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <Button
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n"))}
            >
              Copy to clipboard
            </Button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              No TOTP enrolled. v1 ships as opt-in per user; tenant-wide enforcement
              activates when Fl_Tenant.mfaRequired flips on.
            </div>
            <div>
              <Button variant="primary" onClick={startEnroll} disabled={pending}>
                Enroll MFA
              </Button>
            </div>
          </>
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Card>
  )
}
