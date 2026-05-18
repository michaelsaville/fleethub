"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 12 WS-B — maintenance windows list + create form. Keep it
// pragmatic: cron-string input with a few preset chips + free-text
// override.

interface WindowRow {
  id: string
  tenantName: string
  name: string
  cron: string
  durationMin: number
  suppressAlertKindsJson: string | null
  scopeJson: string | null
  nextStart: string | null
  nextEnd: string | null
  lastFiredAt: string | null
}

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Sun 02:00 weekly", cron: "0 2 * * 0" },
  { label: "Sat 22:00 weekly", cron: "0 22 * * 6" },
  { label: "1st Sun 02:00 monthly", cron: "0 2 1-7 * 0" },
  { label: "Every 4h", cron: "0 */4 * * *" },
  { label: "Daily 03:30", cron: "30 3 * * *" },
]

const SUPPRESS_PRESETS: { label: string; kinds: string[] }[] = [
  { label: "Reboots only", kinds: ["device.rebooted", "device.offline"] },
  { label: "Patch alerts", kinds: ["patch.deferred", "patch.failed"] },
  { label: "Everything", kinds: [] }, // empty array = no suppression filter — equivalent to no-op
]

export default function MaintenanceWindowsClient({
  tenants,
  initialWindows,
}: {
  tenants: string[]
  initialWindows: WindowRow[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [tenantName, setTenantName] = useState(tenants[0] ?? "")
  const [name, setName] = useState("")
  const [cron, setCron] = useState("0 2 * * 0")
  const [durationMin, setDurationMin] = useState(120)
  const [suppressKinds, setSuppressKinds] = useState("")
  const [scope, setScope] = useState("")

  async function submit() {
    setErr(null)
    if (!name.trim() || !cron.trim() || !tenantName) {
      setErr("name, cron, tenant required")
      return
    }
    const suppressArr = suppressKinds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const res = await fetch("/api/admin/maintenance-windows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantName,
        name,
        cron,
        durationMin,
        suppressAlertKindsJson: suppressArr.length > 0 ? JSON.stringify(suppressArr) : null,
        scopeJson: scope.trim() || null,
      }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setErr(j.error ?? `HTTP ${res.status}`)
      return
    }
    setShowCreate(false)
    setName("")
    startTransition(() => router.refresh())
  }

  async function toggleActive(id: string, isActive: boolean) {
    setErr(null)
    const res = await fetch(`/api/admin/maintenance-windows/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setErr(j.error ?? `HTTP ${res.status}`)
      return
    }
    startTransition(() => router.refresh())
  }

  async function remove(id: string) {
    setErr(null)
    const res = await fetch(`/api/admin/maintenance-windows/${id}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setErr(j.error ?? `HTTP ${res.status}`)
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {initialWindows.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {initialWindows.map((w) => (
            <li
              key={w.id}
              style={{
                padding: "10px 12px",
                background: "var(--color-background-tertiary)",
                borderRadius: 6,
                border: "0.5px solid var(--color-border-tertiary)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>
                  {w.name} <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>· {w.tenantName}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                  cron <code>{w.cron}</code> · duration {w.durationMin}m
                </div>
                {w.nextStart && (
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    next: {new Date(w.nextStart).toLocaleString()}
                  </div>
                )}
              </div>
              <Button variant="danger" onClick={() => remove(w.id)} disabled={pending}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      {showCreate ? (
        <div
          style={{
            padding: "12px 14px",
            background: "var(--color-background-tertiary)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Field label="Tenant">
            <select value={tenantName} onChange={(e) => setTenantName(e.target.value)} style={FIELD}>
              {tenants.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} style={FIELD} placeholder="Weekly patch window" />
          </Field>
          <Field label="Cron (5-field)">
            <input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              style={{ ...FIELD, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setCron(p.cron)}
                  style={{
                    fontSize: 10.5,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "0.5px solid var(--color-border-tertiary)",
                    background: "var(--color-background-primary, #fff)",
                    cursor: "pointer",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Duration (min)">
            <input
              type="number"
              min={1}
              max={1440}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              style={{ ...FIELD, width: 120 }}
            />
          </Field>
          <Field label="Suppress alert kinds (comma-sep, optional)">
            <input
              value={suppressKinds}
              onChange={(e) => setSuppressKinds(e.target.value)}
              style={FIELD}
              placeholder="device.rebooted, patch.failed"
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {SUPPRESS_PRESETS.filter((p) => p.kinds.length > 0).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setSuppressKinds(p.kinds.join(", "))}
                  style={{
                    fontSize: 10.5,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "0.5px solid var(--color-border-tertiary)",
                    background: "var(--color-background-primary, #fff)",
                    cursor: "pointer",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Scope (JSON, optional)">
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              style={{ ...FIELD, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
              placeholder='{"deviceTags":["server"]} or {"deviceGroupId":"…"}'
            />
            <span style={{ ...TYPOGRAPHY.HINT, marginTop: 4 }}>
              Empty = every active device in the tenant.
            </span>
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" onClick={submit} disabled={pending}>
              Create window
            </Button>
            <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="primary" onClick={() => setShowCreate(true)} disabled={pending || tenants.length === 0}>
            + New window
          </Button>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={TYPOGRAPHY.LABEL_CAPS}>{label}</span>
      {children}
    </div>
  )
}
