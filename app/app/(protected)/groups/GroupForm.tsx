"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"

// Phase 9 WS-C §5.1 — shared editor for create + edit. Both surfaces
// flow through /api/admin/device-groups (POST) or /[id] (PATCH).

interface Props {
  tenants: string[]
  mode: "create" | "edit"
  initial?: {
    id: string
    tenantName: string
    name: string
    rql: string | null
    pinnedDeviceIds: string[]
  }
}

export default function GroupForm({ tenants, mode, initial }: Props) {
  const router = useRouter()
  const [tenantName, setTenantName] = useState(initial?.tenantName ?? tenants[0] ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [rql, setRql] = useState(initial?.rql ?? "")
  const [pinnedRaw, setPinnedRaw] = useState((initial?.pinnedDeviceIds ?? []).join("\n"))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function submit() {
    setError(null)
    const pinnedDeviceIds = pinnedRaw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!tenantName || !name.trim()) {
      setError("Tenant + name required")
      return
    }
    if (!rql.trim() && pinnedDeviceIds.length === 0) {
      setError("Either RQL or pinned device IDs must be set")
      return
    }
    const payload = { tenantName, name: name.trim(), rql: rql.trim() || null, pinnedDeviceIds }
    const url = mode === "create" ? "/api/admin/device-groups" : `/api/admin/device-groups/${initial!.id}`
    const method = mode === "create" ? "POST" : "PATCH"
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    startTransition(() => router.push("/groups"))
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={TYPOGRAPHY.LABEL_CAPS}>Tenant</label>
        <select value={tenantName} onChange={(e) => setTenantName(e.target.value)} style={{ ...FIELD, width: "100%", marginTop: 4 }}>
          {tenants.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label style={TYPOGRAPHY.LABEL_CAPS}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="All Veeam-protected" style={{ ...FIELD, width: "100%", marginTop: 4 }} />
      </div>
      <div>
        <label style={TYPOGRAPHY.LABEL_CAPS}>RQL (optional)</label>
        <input value={rql} onChange={(e) => setRql(e.target.value)} placeholder="os = windows AND role = server" style={{ ...FIELD, width: "100%", marginTop: 4, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12 }} />
        <div style={TYPOGRAPHY.HINT}>v1 RQL: any non-empty value resolves to "all active devices in tenant". Real parser lands in v1.5.</div>
      </div>
      <div>
        <label style={TYPOGRAPHY.LABEL_CAPS}>Pinned device IDs (one per line)</label>
        <textarea value={pinnedRaw} onChange={(e) => setPinnedRaw(e.target.value)} rows={5} placeholder="cmkzz3ozx0001abcd" style={{ ...FIELD, width: "100%", marginTop: 4, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, resize: "vertical" }} />
      </div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create" : "Save"}
        </Button>
      </div>
    </div>
  )
}
