"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

interface Props {
  next: string
  hasRecoveryCodes: boolean
}

export default function MfaChallengeForm({ next, hasRecoveryCodes }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<"totp" | "recovery">("totp")
  const [token, setToken] = useState("")
  const [recovery, setRecovery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function submit() {
    setError(null)
    const body = mode === "totp" ? { token } : { recoveryCode: recovery }
    const res = await fetch("/api/auth/mfa-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `Verification failed (HTTP ${res.status})`)
      return
    }
    // Cookie is set by the server; navigate to next destination.
    startTransition(() => {
      router.replace(next)
      router.refresh()
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {mode === "totp" ? (
        <div>
          <label style={TYPOGRAPHY.LABEL_CAPS}>6-digit code</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="123456"
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
            style={{
              ...FIELD,
              width: "100%",
              marginTop: 4,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 18,
              letterSpacing: "0.2em",
              textAlign: "center",
            }}
            autoFocus
            autoComplete="one-time-code"
          />
        </div>
      ) : (
        <div>
          <label style={TYPOGRAPHY.LABEL_CAPS}>Recovery code</label>
          <input
            type="text"
            maxLength={16}
            placeholder="A1B2C3D4"
            value={recovery}
            onChange={(e) => setRecovery(e.target.value.toUpperCase())}
            style={{
              ...FIELD,
              width: "100%",
              marginTop: 4,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 16,
              letterSpacing: "0.1em",
              textAlign: "center",
            }}
            autoFocus
          />
          <p style={{ ...TYPOGRAPHY.HINT, marginTop: 6 }}>
            Recovery codes are single-use. You'll need to regenerate a new set
            from /setup/staff/[id]?tab=mfa after sign-in.
          </p>
        </div>
      )}

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <Button
        variant="primary"
        onClick={submit}
        disabled={
          pending || (mode === "totp" ? token.length !== 6 : recovery.trim().length === 0)
        }
      >
        {pending ? "Verifying…" : "Verify"}
      </Button>

      {hasRecoveryCodes && (
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "totp" ? "recovery" : "totp"))
            setError(null)
          }}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            fontSize: 12,
            textDecoration: "underline",
            cursor: "pointer",
            alignSelf: "center",
          }}
        >
          {mode === "totp" ? "Use a recovery code" : "Use TOTP instead"}
        </button>
      )}
    </div>
  )
}
