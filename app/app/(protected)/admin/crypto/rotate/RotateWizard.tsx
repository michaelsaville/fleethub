"use client"
import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { MaskedField } from "@/components/ui/MaskedField"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

interface InflightRotation {
  id: string
  state: string
  processed: number
  total: number
  currentTenant: string | null
  fromVersion: number
  toVersion: number
  errorMsg: string | null
}

interface Props {
  purpose: string
  currentVersion: number
  currentFingerprint: string
  totalCredentials: number
  lastRotationAt: string | null
  inflight: InflightRotation | null
}

// Phase 12 WS-C.3 — wizard client. Three explicit phases:
//   "preflight" → "confirm" → "progress"

export default function RotateWizard({
  purpose,
  currentVersion,
  currentFingerprint,
  totalCredentials,
  lastRotationAt,
  inflight,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [phase, setPhase] = useState<"preflight" | "confirm" | "progress">(
    inflight ? "progress" : "preflight",
  )
  const [err, setErr] = useState<string | null>(null)
  const [typed, setTyped] = useState("")
  const [stepUpCode, setStepUpCode] = useState("")
  const [progress, setProgress] = useState<InflightRotation | null>(inflight)

  // Poll progress when in the progress phase.
  useEffect(() => {
    if (phase !== "progress" || !progress) return
    if (progress.state !== "in-progress") return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/crypto/rotate/${progress.id}`)
        if (!res.ok) return
        const data = (await res.json()) as InflightRotation
        setProgress(data)
        if (data.state !== "in-progress") {
          // Done or failed — stop polling, refresh router so /admin/crypto
          // sees the new active key.
          clearInterval(interval)
          startTransition(() => router.refresh())
        }
      } catch {
        // ignore — try again next tick
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [phase, progress, router])

  async function beginConfirm() {
    setPhase("confirm")
    setErr(null)
  }

  async function submitRotate() {
    setErr(null)
    if (typed !== `rotate ${purpose}`) {
      setErr(`Type exactly: rotate ${purpose}`)
      return
    }
    if (stepUpCode.length !== 6) {
      setErr("Step-up: enter your current 6-digit TOTP code")
      return
    }
    // 1. Mint a step-up token via /api/auth/mfa-stepup
    const stepRes = await fetch("/api/auth/mfa-stepup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: stepUpCode }),
    })
    if (!stepRes.ok) {
      const j = (await stepRes.json().catch(() => ({}))) as { error?: string }
      setErr(j.error ?? `step-up HTTP ${stepRes.status}`)
      return
    }
    const { stepUpToken } = (await stepRes.json()) as { stepUpToken: string }
    // 2. POST /api/admin/crypto/rotate with the step-up token.
    const rotRes = await fetch("/api/admin/crypto/rotate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-FleetHub-StepUp": stepUpToken,
      },
      body: JSON.stringify({ purpose }),
    })
    if (!rotRes.ok && rotRes.status !== 202) {
      const j = (await rotRes.json().catch(() => ({}))) as { error?: string }
      setErr(j.error ?? `rotate HTTP ${rotRes.status}`)
      return
    }
    const data = (await rotRes.json()) as {
      rotationId: string
      fromVersion: number
      toVersion: number
      total: number
    }
    setProgress({
      id: data.rotationId,
      state: "in-progress",
      processed: 0,
      total: data.total,
      currentTenant: null,
      fromVersion: data.fromVersion,
      toVersion: data.toVersion,
      errorMsg: null,
    })
    setPhase("progress")
  }

  // ─── PRE-FLIGHT ───────────────────────────────────────────────
  if (phase === "preflight") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        <InlineAlert tone="warn">
          Rotating <strong>{purpose}</strong> re-encrypts every active credential
          row under a new key. The operation takes seconds-to-minutes
          depending on credential count. A failure mid-flight leaves the new
          key active; resumable rerun completes the rewrap.
        </InlineAlert>
        <Row label="Purpose">{purpose}</Row>
        <Row label="Current version">v{currentVersion}</Row>
        <Row label="Current fingerprint">
          <MaskedField
            value={currentFingerprint}
            displayMasked={`••••${currentFingerprint.slice(-4)}`}
            compact
          />
        </Row>
        <Row label="Credentials to rewrap">{totalCredentials}</Row>
        <Row label="Last rotation">
          {lastRotationAt ? new Date(lastRotationAt).toLocaleString() : "never"}
        </Row>
        <div style={{ marginTop: 12 }}>
          <Button variant="danger" onClick={beginConfirm} disabled={pending}>
            Begin rotation…
          </Button>
        </div>
      </div>
    )
  }

  // ─── CONFIRM ──────────────────────────────────────────────────
  if (phase === "confirm") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
        <Row label="Confirm phrase">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{ ...FIELD, width: 280, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
            placeholder={`rotate ${purpose}`}
          />
          <div style={{ ...TYPOGRAPHY.HINT, marginTop: 4 }}>
            Type exactly: <code>rotate {purpose}</code>
          </div>
        </Row>
        <Row label="Step-up TOTP">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={stepUpCode}
            onChange={(e) => setStepUpCode(e.target.value)}
            style={{ ...FIELD, width: 140, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
            placeholder="123456"
          />
          <div style={{ ...TYPOGRAPHY.HINT, marginTop: 4 }}>
            Current 6-digit code from your authenticator.
          </div>
        </Row>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button
            variant="danger"
            onClick={submitRotate}
            disabled={pending || typed !== `rotate ${purpose}` || stepUpCode.length !== 6}
          >
            Confirm + rotate
          </Button>
          <Button variant="secondary" onClick={() => setPhase("preflight")} disabled={pending}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  // ─── PROGRESS ─────────────────────────────────────────────────
  if (!progress) {
    return <InlineAlert tone="danger">Lost rotation state — refresh the page.</InlineAlert>
  }
  const pct = progress.total === 0 ? 100 : Math.round((progress.processed / progress.total) * 100)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Row label="Rotation">
        v{progress.fromVersion} → v{progress.toVersion}
      </Row>
      <Row label="State">{progress.state}</Row>
      <Row label="Progress">
        {progress.processed} / {progress.total} ({pct}%)
      </Row>
      <Row label="Current tenant">{progress.currentTenant ?? "—"}</Row>
      <div
        style={{
          height: 8,
          background: "var(--color-background-tertiary)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background:
              progress.state === "failed"
                ? "var(--color-danger)"
                : progress.state === "done"
                ? "var(--color-success)"
                : "var(--color-accent)",
            transition: "width 0.5s ease",
          }}
        />
      </div>
      {progress.errorMsg && (
        <InlineAlert tone="danger">{progress.errorMsg}</InlineAlert>
      )}
      {progress.state === "done" && (
        <InlineAlert tone="ok">
          Rotation complete. All credentials now encrypted under v{progress.toVersion}.
        </InlineAlert>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={TYPOGRAPHY.LABEL_CAPS}>{label}</span>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  )
}
