"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

interface SeedResult {
  ok: boolean
  seed: { patchesUpserted: number; installRowsCreated: number }
  cveIngest: { totalInCatalog: number; newAdvisories: number; updatedAdvisories: number; errors: string[] }
}

export default function SeedPatchesButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SeedResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function seed() {
    if (!confirm("Seed mock patch catalog + ingest CISA KEV (~1200 CVEs)?\nThis hits the public CISA endpoint and writes ~24 patches + per-host mock install state.")) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/_seed/patches", { method: "POST" })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as SeedResult
      setResult(data)
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <button
        onClick={seed}
        disabled={busy}
        style={{
          fontSize: 12,
          fontWeight: 500,
          padding: "6px 14px",
          borderRadius: 6,
          background: busy ? "var(--color-background-tertiary)" : "var(--color-accent)",
          color: "#fff",
          cursor: busy ? "not-allowed" : "pointer",
          border: "0.5px solid var(--color-border-secondary)",
        }}
      >
        {busy ? "Seeding…" : "+ Seed catalog + CVE feed"}
      </button>
      {error && <span style={{ color: "var(--color-danger)", fontSize: 11 }}>{error}</span>}
      {result && (
        <span style={{ color: "var(--color-success)", fontSize: 11 }}>
          ✓ {result.seed.patchesUpserted} patches · {result.cveIngest.newAdvisories} new CVEs · {result.cveIngest.updatedAdvisories} updated
        </span>
      )}
    </div>
  )
}
