"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

/** Click → POST /api/devices/[id]/patches/scan and refresh. Reflects
 *  the gateway dispatch outcome inline so the operator can see why a
 *  scan refused without bouncing to the audit log. */
export default function PatchesScanButton({ deviceId }: { deviceId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null)

  async function scan() {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch(`/api/devices/${deviceId}/patches/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        commandId?: string
        reason?: string
        message?: string
      }
      if (res.ok && data.ok) {
        setStatus({ tone: "ok", text: `Scan dispatched · ${data.commandId ?? ""}` })
        // Defer the refresh so the operator sees the success state
        // before the page rerenders.
        setTimeout(() => router.refresh(), 1200)
      } else {
        const reason = data.reason ?? "error"
        setStatus({
          tone: reason === "not-enrolled" ? "warn" : "danger",
          text:
            reason === "not-enrolled"
              ? "Device has no enrolled agent."
              : data.message ?? `Dispatch failed: ${reason}`,
        })
      }
    } catch (e) {
      setStatus({
        tone: "danger",
        text: `Request failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const toneColor =
    status?.tone === "ok"
      ? "var(--color-success)"
      : status?.tone === "warn"
        ? "var(--color-warning)"
        : status?.tone === "danger"
          ? "var(--color-danger)"
          : "var(--color-text-muted)"

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={scan}
        disabled={busy}
        style={{
          fontSize: 12,
          fontWeight: 500,
          padding: "5px 12px",
          borderRadius: 5,
          border: "0.5px solid var(--color-border-secondary)",
          background: "var(--color-background-tertiary)",
          color: "var(--color-text-primary)",
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "Dispatching…" : "Scan now"}
      </button>
      {status && (
        <span style={{ fontSize: 11, color: toneColor }}>{status.text}</span>
      )}
    </div>
  )
}
