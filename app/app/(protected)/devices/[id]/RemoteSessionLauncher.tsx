"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

// Phase 7 Workstream C step 3 — Remote in button + justification
// modal. Calls the openRemoteSession server action via a fetch to
// /api/admin/remote-sessions (added as a thin POST endpoint) and
// then launches the rustdesk:// deep link in a new tab.
//
// The button is gated:
// - Disabled with a clear hint when tenant.remoteControlEnabled
//   is false, when the device has no rustdeskId, or when the
//   operator isn't ADMIN.
// - When tenant.remoteRequiresJustification is true, the modal
//   forces a non-empty justification.

interface Props {
  deviceId: string
  rustdeskId: string | null
  remoteControlEnabled: boolean
  requiresJustification: boolean
  canOpen: boolean
}

export default function RemoteSessionLauncher({
  deviceId,
  rustdeskId,
  remoteControlEnabled,
  requiresJustification,
  canOpen,
}: Props) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [justification, setJustification] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonHints: string[] = []
  if (!canOpen) reasonHints.push("signed in")
  if (!remoteControlEnabled) reasonHints.push("tenant has remote control disabled")
  if (!rustdeskId) reasonHints.push("device has no RustDesk peer ID set")
  const disabled = !canOpen || !remoteControlEnabled || !rustdeskId
  const disabledHint = disabled ? `Requires: ${reasonHints.join(", ")}` : null

  function onClick() {
    if (disabled) return
    setJustification("")
    setError(null)
    setModalOpen(true)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/remote-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, justification: justification.trim() }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      const j = (await res.json()) as {
        sessionId: string
        deepLink: string
        mode: "pro" | "free"
      }
      setModalOpen(false)
      setSubmitting(false)
      router.refresh()
      // window.open with target=_self triggers the rustdesk:// handler
      // without leaving the operator on a blank tab. If they don't
      // have the RustDesk client installed, the browser shows its
      // standard "open with..." prompt; FleetHub stays where it was.
      window.location.href = j.deepLink
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabledHint ?? "Open a remote-control session"}
        style={{
          padding: "6px 12px",
          fontSize: 13,
          fontWeight: 600,
          color: disabled ? "var(--color-text-muted)" : "#fff",
          background: disabled ? "var(--color-background-tertiary, rgba(148, 163, 184, 0.18))" : "var(--color-accent, #F97316)",
          border: "none",
          borderRadius: 6,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        Remote in
      </button>

      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Open remote-control session"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !submitting) setModalOpen(false) }}
        >
          <form
            onSubmit={onSubmit}
            style={{
              width: 460,
              maxWidth: "90vw",
              background: "var(--color-background-primary, #fff)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: 10,
              padding: "20px 22px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Open remote-control session</h2>
            <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: 0 }}>
              {requiresJustification
                ? <>This tenant requires a justification on every remote session. The reason is written to the audit chain.</>
                : <>FleetHub will mint a session via RustDesk (or hand off in free mode), audit the open, and try to launch your local RustDesk client.</>}
            </p>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                Justification {requiresJustification ? <span style={{ color: "var(--color-danger, #b91c1c)" }}>*</span> : <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>(optional)</span>}
              </span>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={3}
                autoFocus
                placeholder={requiresJustification ? "Why are you remoting in?" : "Optional context for the audit row"}
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
                  background: "var(--color-background-primary, #fff)",
                  color: "var(--color-text-primary)",
                  border: "0.5px solid var(--color-border-secondary, #d4d4d8)",
                  borderRadius: 6,
                  outline: "none",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </label>
            {error && (
              <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--color-danger, #b91c1c)", background: "var(--color-danger-soft, rgba(239, 68, 68, 0.1))", borderRadius: 6 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setModalOpen(false)} disabled={submitting} style={{ padding: "8px 14px", fontSize: 13, color: "var(--color-text-secondary)", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, cursor: submitting ? "not-allowed" : "pointer" }}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || (requiresJustification && justification.trim().length < 4)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--color-accent, #F97316)",
                  border: "none",
                  borderRadius: 6,
                  cursor: submitting ? "not-allowed" : "pointer",
                  opacity: submitting || (requiresJustification && justification.trim().length < 4) ? 0.6 : 1,
                }}
              >
                {submitting ? "Opening…" : "Open session"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
