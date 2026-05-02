"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

export default function RingSeedButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function seed() {
    setBusy(true)
    try {
      // Pull the first device's clientName as the tenant. UI is single-tenant
      // for now; multi-tenant support lands in Phase 3 step 6+.
      const res = await fetch("/api/_seed/rings", { method: "POST" })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        alert(data.error || `HTTP ${res.status}`)
      }
      startTransition(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }

  return (
    <button onClick={seed} disabled={busy} style={{
      fontSize: 12,
      fontWeight: 500,
      padding: "6px 14px",
      borderRadius: 6,
      border: "0.5px solid var(--color-border-secondary)",
      background: "var(--color-accent)",
      color: "#fff",
      cursor: "pointer",
    }}>
      {busy ? "Seeding…" : "+ Seed default rings"}
    </button>
  )
}
