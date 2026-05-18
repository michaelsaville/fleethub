"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { startRegistration } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 11 WS-C.6 — self-service security center client.
//
// Three sections:
//   1. TOTP enrollment / disable
//   2. WebAuthn credentials (list / enroll / delete)
//   3. Recovery codes count + regenerate

interface WebAuthnCred {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  transports: string[]
}

interface Props {
  staffId: string
  email: string
  totpEnabledAt: string | null
  remainingRecoveryCodes: number
  webauthnCreds: WebAuthnCred[]
}

interface EnrollResp {
  secret: string
  qrDataUrl: string
}

export default function SecurityClient({
  staffId,
  email,
  totpEnabledAt,
  remainingRecoveryCodes,
  webauthnCreds,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [enrollData, setEnrollData] = useState<EnrollResp | null>(null)
  const [code, setCode] = useState("")
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null)
  const [webauthnName, setWebauthnName] = useState("")
  const [regenCode, setRegenCode] = useState("")
  const [regenOpen, setRegenOpen] = useState(false)

  async function startEnroll() {
    setError(null)
    setNewRecoveryCodes(null)
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
    setNewRecoveryCodes(data.recoveryCodes)
    setEnrollData(null)
    setCode("")
    startTransition(() => router.refresh())
  }

  async function regenRecovery() {
    setError(null)
    const res = await fetch(
      `/api/admin/staff/${staffId}/mfa/regenerate-recovery`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: regenCode }),
      },
    )
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    const data = (await res.json()) as { recoveryCodes: string[] }
    setNewRecoveryCodes(data.recoveryCodes)
    setRegenOpen(false)
    setRegenCode("")
    startTransition(() => router.refresh())
  }

  async function addWebauthn() {
    setError(null)
    if (!webauthnName.trim()) {
      setError("Name your authenticator (e.g. MacBook TouchID)")
      return
    }
    try {
      const optsRes = await fetch("/api/auth/webauthn/register/options", {
        method: "POST",
      })
      if (!optsRes.ok) {
        const j = (await optsRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `options HTTP ${optsRes.status}`)
      }
      const options = await optsRes.json()
      const attestation = await startRegistration(options)
      const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: attestation, name: webauthnName.trim() }),
      })
      if (!verifyRes.ok) {
        const j = (await verifyRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `verify HTTP ${verifyRes.status}`)
      }
      setWebauthnName("")
      startTransition(() => router.refresh())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function deleteWebauthn(credId: string) {
    setError(null)
    const res = await fetch(`/api/account/webauthn-creds/${credId}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      {/* TOTP section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {totpEnabledAt ? (
          <div style={{ fontSize: 13 }}>
            ✓ TOTP enrolled <span style={{ color: "var(--color-text-muted)" }}>{new Date(totpEnabledAt).toLocaleString()}</span>
          </div>
        ) : enrollData ? (
          <>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              Scan with an authenticator app for <strong>{email}</strong>, then
              enter the first 6-digit code.
            </div>
            <img
              src={enrollData.qrDataUrl}
              alt="MFA QR code"
              width={220}
              height={220}
              style={{ background: "#fff", padding: 8, borderRadius: 6 }}
            />
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
        ) : (
          <div>
            <Button variant="primary" onClick={startEnroll} disabled={pending}>
              Enroll TOTP
            </Button>
          </div>
        )}
      </div>

      {/* Recovery codes section */}
      {totpEnabledAt && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 12 }}>
          <div style={{ ...TYPOGRAPHY.LABEL_CAPS }}>Recovery codes</div>
          <div style={{ fontSize: 13 }}>
            {remainingRecoveryCodes} of 10 unused.
            {remainingRecoveryCodes <= 3 && (
              <span style={{ color: "var(--color-text-warning, #b45309)", marginLeft: 8 }}>
                {remainingRecoveryCodes === 0 ? "All codes used — regenerate now." : "Running low."}
              </span>
            )}
          </div>
          {!regenOpen ? (
            <div>
              <Button variant="secondary" onClick={() => setRegenOpen(true)} disabled={pending}>
                Regenerate codes
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="current 6-digit"
                value={regenCode}
                onChange={(e) => setRegenCode(e.target.value)}
                style={{ ...FIELD, width: 160, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
              />
              <Button variant="danger" onClick={regenRecovery} disabled={pending || regenCode.length !== 6}>
                Confirm regenerate
              </Button>
              <Button variant="secondary" onClick={() => { setRegenOpen(false); setRegenCode("") }} disabled={pending}>
                Cancel
              </Button>
            </div>
          )}
          {newRecoveryCodes && (
            <>
              <InlineAlert tone="warn">
                Save these recovery codes now — they will not be shown again.
              </InlineAlert>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, padding: "8px 10px", background: "var(--color-background-tertiary)", borderRadius: 6, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 13 }}>
                {newRecoveryCodes.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </div>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => navigator.clipboard.writeText(newRecoveryCodes.join("\n"))}
                >
                  Copy to clipboard
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* WebAuthn section */}
      {totpEnabledAt && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 12 }}>
          <div style={{ ...TYPOGRAPHY.LABEL_CAPS }}>Passkeys / security keys</div>
          {webauthnCreds.length === 0 ? (
            <div style={{ ...TYPOGRAPHY.HINT }}>
              No passkeys enrolled. Add one to use it for step-up authentication
              on sensitive actions.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {webauthnCreds.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    background: "var(--color-background-tertiary)",
                    borderRadius: 6,
                    fontSize: 12.5,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{c.name}</div>
                    <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                      Added {new Date(c.createdAt).toLocaleDateString()} ·{" "}
                      {c.lastUsedAt ? `last used ${new Date(c.lastUsedAt).toLocaleDateString()}` : "never used"}
                    </div>
                  </div>
                  <Button variant="danger" onClick={() => deleteWebauthn(c.id)} disabled={pending}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              placeholder="Name this authenticator"
              value={webauthnName}
              onChange={(e) => setWebauthnName(e.target.value)}
              style={{ ...FIELD, width: 240 }}
            />
            <Button variant="primary" onClick={addWebauthn} disabled={pending || !webauthnName.trim()}>
              Add passkey
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
