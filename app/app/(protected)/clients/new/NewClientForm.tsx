"use client"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

// Pick the client from TicketHub instead of retyping its name. The DB is
// shared, Fl_Tenant.name must equal TH_Client.name byte-for-byte, and the
// API already refuses anything that doesn't exist in TH — so the form
// only offers what will be accepted.

interface Candidate {
  name: string
  shortCode: string | null
  city: string | null
  clientType: string
  contacts: number
  isTenant: boolean
}

const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }

export default function NewClientForm() {
  const router = useRouter()
  const [all, setAll] = useState<Candidate[] | null>(null)
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<Candidate | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/admin/tenants/candidates")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as { clients: Candidate[] }
      })
      .then((j) => setAll(j.clients))
      .catch((e: Error) => setError(`Could not load TicketHub clients: ${e.message}`))
  }, [])

  const shown = useMemo(() => {
    if (!all) return []
    const needle = q.trim().toLowerCase()
    const list = needle
      ? all.filter((c) => c.name.toLowerCase().includes(needle) || c.shortCode?.toLowerCase().includes(needle))
      : all
    // Not-yet-tenants first; already-added clients sink to the bottom.
    return [...list].sort((a, b) => Number(a.isTenant) - Number(b.isTenant) || a.name.localeCompare(b.name))
  }, [all, q])

  async function create() {
    if (!picked || picked.isTenant) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: picked.name }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      const j = (await res.json().catch(() => ({}))) as { tenant?: { name?: string } }
      const canonical = j.tenant?.name ?? picked.name
      router.push(`/clients/${encodeURIComponent(canonical)}?tab=install`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
      setSubmitting(false)
    }
  }

  const box: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: 10,
  }

  return (
    <div style={box}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
          Find the client in TicketHub
        </span>
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPicked(null)
          }}
          placeholder={all ? `Search ${all.length} clients by name or code…` : "Loading…"}
          disabled={!all || submitting}
          style={{
            padding: "8px 10px",
            fontSize: 13,
            background: "var(--color-background-primary, #fff)",
            color: "var(--color-text-primary)",
            border: "0.5px solid var(--color-border-secondary, #d4d4d8)",
            borderRadius: 6,
            outline: "none",
          }}
        />
      </label>

      <div
        role="listbox"
        aria-label="TicketHub clients"
        style={{
          maxHeight: 320,
          overflowY: "auto",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: 6,
          background: "var(--color-background-primary, #fff)",
        }}
      >
        {all && shown.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: "var(--color-text-muted)" }}>
            No TicketHub client matches. Create it in TicketHub first, then come back.
          </div>
        )}
        {shown.map((c) => {
          const active = picked?.name === c.name
          return (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={active}
              disabled={c.isTenant || submitting}
              onClick={() => setPicked(c)}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                textAlign: "left",
                background: active ? "var(--color-accent-soft, rgba(249,115,22,0.12))" : "transparent",
                border: "none",
                borderBottom: "0.5px solid var(--color-border-tertiary)",
                color: c.isTenant ? "var(--color-text-muted)" : "var(--color-text-primary)",
                cursor: c.isTenant ? "default" : "pointer",
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1 }}>
                {c.name}
                {c.shortCode && <span style={{ ...mono, marginLeft: 8, color: "var(--color-text-muted)" }}>{c.shortCode}</span>}
              </span>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                {c.clientType === "RESIDENTIAL" ? "residential · " : ""}
                {c.city ?? ""}
                {c.contacts ? ` · ${c.contacts} contact${c.contacts === 1 ? "" : "s"}` : ""}
              </span>
              {c.isTenant && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>already in FleetHub</span>}
            </button>
          )
        })}
      </div>

      {error && (
        <div
          style={{
            padding: "8px 10px",
            fontSize: 12,
            color: "var(--color-danger, #b91c1c)",
            background: "var(--color-danger-soft, rgba(239, 68, 68, 0.1))",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)", flex: 1 }}>
          {picked ? (
            <>
              Will be created as <code style={mono}>{picked.name}</code> — TicketHub&rsquo;s exact name.
            </>
          ) : (
            "Names come straight from TicketHub, so agents and tickets line up."
          )}
        </span>
        <Link href="/clients" style={{ padding: "8px 14px", fontSize: 13, color: "var(--color-text-secondary)", textDecoration: "none" }}>
          Cancel
        </Link>
        <button
          type="button"
          onClick={create}
          disabled={submitting || !picked || picked.isTenant}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-accent, #F97316)",
            border: "none",
            borderRadius: 6,
            cursor: submitting || !picked ? "not-allowed" : "pointer",
            opacity: submitting || !picked ? 0.6 : 1,
          }}
        >
          {submitting ? "Creating…" : "Add to FleetHub"}
        </button>
      </div>
    </div>
  )
}
