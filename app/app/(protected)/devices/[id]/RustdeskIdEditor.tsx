"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"

// Phase 7 Workstream C step 3 — inline editor for
// Fl_Device.rustdeskId. ADMIN-only; the device page only renders
// this component when the operator is ADMIN.

export default function RustdeskIdEditor({
  deviceId,
  current,
}: {
  deviceId: string
  current: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(current ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = (value.trim() || null) !== (current ?? null)

  async function onSave() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/devices/${deviceId}/rustdesk-id`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rustdeskId: value.trim() }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      router.refresh()
      setSubmitting(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="123456789 or peer alias"
        style={{
          padding: "6px 9px",
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          background: "var(--color-background-primary, #fff)",
          color: "var(--color-text-primary)",
          border: "0.5px solid var(--color-border-secondary, #d4d4d8)",
          borderRadius: 6,
          outline: "none",
          width: 220,
        }}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || submitting}
        style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          background: !dirty || submitting ? "var(--color-text-muted)" : "var(--color-accent, #F97316)",
          border: "none",
          borderRadius: 6,
          cursor: !dirty || submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Saving…" : current ? "Update" : "Save"}
      </button>
      {error && <span style={{ fontSize: 11.5, color: "var(--color-danger, #b91c1c)" }}>{error}</span>}
    </div>
  )
}
