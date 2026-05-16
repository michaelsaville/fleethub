"use client"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Button } from "./Button"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 8 Workstream C — shared confirm modal. Replaces every
// window.confirm() call across the app + adds a typed-name gate
// for the worst-three destructive ops (route delete, runbook
// delete, schedule delete) per the TicketHub double-confirm
// precedent.
//
// Usage (controlled):
//   <ConfirmModal
//     open={open}
//     onClose={() => setOpen(false)}
//     onConfirm={async () => { ... }}
//     title="Delete this route?"
//     body="Historical dispatches stay in the audit log; this
//           rule won't evaluate further."
//     confirmLabel="Delete"
//     tone="danger"
//   />
//
// With typed-name gate:
//   <ConfirmModal
//     ...
//     typedName={{ expected: route.tenantName, prompt: "Type the
//                  tenant name to confirm:" }}
//   />

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: ReactNode
  body: ReactNode
  /** Defaults to "Confirm". */
  confirmLabel?: string
  /** Defaults to "Cancel". */
  cancelLabel?: string
  /** "danger" tints the confirm button red; "primary" uses accent. */
  tone?: "primary" | "danger"
  /** When set, the operator must type the expected value before the
   *  confirm button enables. Used for the highest-stakes ops. */
  typedName?: {
    expected: string
    prompt: ReactNode
  }
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  typedName,
}: Props) {
  const [typed, setTyped] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state on close so the next open is fresh. Also lock the
  // body scroll while the modal is up.
  useEffect(() => {
    if (!open) {
      setTyped("")
      setSubmitting(false)
      setError(null)
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
  }, [open, submitting, onClose])

  if (!open) return null

  const gated = typedName !== undefined && typed.trim() !== typedName.expected
  const canConfirm = !gated && !submitting

  async function handleConfirm() {
    if (!canConfirm) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm action failed")
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: "100%",
          background: "var(--color-background-primary)",
          color: "var(--color-text-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--radius-md)",
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h2 style={{ ...TYPOGRAPHY.H2, fontSize: "16px" }}>{title}</h2>
        <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          {body}
        </div>
        {typedName && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={TYPOGRAPHY.HINT}>{typedName.prompt}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typedName.expected}
              autoFocus
              style={FIELD}
            />
          </label>
        )}
        {error && (
          <div style={{
            padding: "8px 10px",
            fontSize: "12px",
            color: "var(--color-danger)",
            background: "var(--color-danger-soft)",
            borderRadius: "var(--radius-sm)",
          }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {submitting ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
