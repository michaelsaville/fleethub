"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { InlineAlert } from "@/components/ui/InlineAlert"

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
  /** 2026-09-13: ControlR is the preferred provider when it knows this host. */
  controlrDeviceId: string | null
  controlrOnline: boolean | null
  remoteControlEnabled: boolean
  requiresJustification: boolean
  canOpen: boolean
}

// ControlR's web viewer — a normal https page with a single-use logon
// token in the URL. New tab so FleetHub stays put.
//
// ControlR 0.27.6 quirk (fixed upstream in 0.28, not yet published as an
// image): the token request signs the browser in (cookie) but the
// prerendered page doesn't persist that auth state to the WASM client, so
// the FIRST render shows "You are not authorized" even though the session
// cookie is now valid. Loading the same page WITHOUT the token then renders
// signed in. So: open the token URL, wait for that navigation to commit
// (reading a cross-origin window's location throws — that's the signal),
// then replace it with the clean URL. On 0.28+ the second hop is a no-op
// (ControlR itself strips the token) — remove this once we're there.
function openControlR(deepLink: string) {
  const clean = deepLink.replace(/([?&])logonToken=[^&]*&?/, "$1").replace(/[?&]$/, "")
  const w = window.open(deepLink, "_blank", deepLink.includes("logonToken=") ? undefined : "noopener")
  if (!w) {
    window.location.href = deepLink
    return
  }
  if (!deepLink.includes("logonToken=")) return // plain deep link (CONTROLR_LOGON_TOKENS=off)
  const started = Date.now()
  const iv = window.setInterval(() => {
    let committed = false
    try {
      // Same-origin while still about:blank; throws once ControlR's
      // document is committed.
      void w.location.href
    } catch {
      committed = true
    }
    if (committed || Date.now() - started > 8000 || w.closed) {
      window.clearInterval(iv)
      if (w.closed) return
      window.setTimeout(() => {
        try {
          w.location.replace(clean)
        } catch {
          /* cross-origin navigation of an opened window is allowed; ignore */
        }
      }, 900)
    }
  }, 150)
}

export default function RemoteSessionLauncher({
  deviceId,
  rustdeskId,
  controlrDeviceId,
  controlrOnline,
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
  const hasProvider = !!controlrDeviceId || !!rustdeskId
  if (!hasProvider) reasonHints.push("device is not enrolled in ControlR and has no RustDesk peer ID")
  if (controlrDeviceId && controlrOnline === false && !rustdeskId) reasonHints.push("device is offline in ControlR")
  const disabled = !canOpen || !remoteControlEnabled || !hasProvider || (!!controlrDeviceId && controlrOnline === false && !rustdeskId)
  const disabledHint = disabled ? `Requires: ${reasonHints.join(", ")}` : null
  const via = controlrDeviceId ? "ControlR" : "RustDesk"

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
        mode: "pro" | "free" | "controlr"
      }
      setModalOpen(false)
      setSubmitting(false)
      router.refresh()
      if (j.mode === "controlr") {
        openControlR(j.deepLink)
        return
      }
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
        title={disabledHint ?? `Open a remote-control session via ${via}`}
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
            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
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
