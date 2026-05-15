"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function NewClientForm() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Name is required.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      const j = (await res.json().catch(() => ({}))) as { tenant?: { name?: string } }
      const canonical = j.tenant?.name ?? trimmed
      router.push(`/clients/${encodeURIComponent(canonical)}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
          Client name
        </span>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="e.g. Liller Brothers Paving"
          disabled={submitting}
          style={{
            padding: "8px 10px",
            fontSize: "13px",
            background: "var(--color-background-primary, #fff)",
            color: "var(--color-text-primary)",
            border: "0.5px solid var(--color-border-secondary, #d4d4d8)",
            borderRadius: "6px",
            outline: "none",
          }}
        />
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          Must match the agent&rsquo;s registered{" "}
          <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px" }}>
            clientName
          </code>{" "}
          and TicketHub&rsquo;s{" "}
          <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px" }}>
            TH_Client.name
          </code>
          .
        </span>
      </label>

      {error && (
        <div
          style={{
            padding: "8px 10px",
            fontSize: "12px",
            color: "var(--color-danger, #b91c1c)",
            background: "var(--color-danger-soft, rgba(239, 68, 68, 0.1))",
            borderRadius: "6px",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <Link
          href="/clients"
          style={{
            padding: "8px 14px",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
            textDecoration: "none",
            borderRadius: "6px",
          }}
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          style={{
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-accent, #F97316)",
            border: "none",
            borderRadius: "6px",
            cursor: submitting || !name.trim() ? "not-allowed" : "pointer",
            opacity: submitting || !name.trim() ? 0.6 : 1,
          }}
        >
          {submitting ? "Creating…" : "Create client"}
        </button>
      </div>
    </form>
  )
}
