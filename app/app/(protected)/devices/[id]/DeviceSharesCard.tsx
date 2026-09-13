"use client"
import { useCallback, useEffect, useState } from "react"

// Customer self-service remote access (2026-09-13): which portal users may
// remote into this device from portal.pcc2k.com. Suggestions come from the
// client's TicketHub contacts (flagged when they already have a portal
// login). Mounted on the device page → Remote tab.

interface Share {
  id: string
  portalEmail: string
  grantedByEmail: string
  note: string | null
  expiresAt: string | null
  lastUsedAt: string | null
  useCount: number
  createdAt: string
  hasPortalLogin: boolean
}
interface Suggestion {
  email: string
  name: string
  jobTitle: string | null
  hasPortalLogin: boolean
}
interface Payload {
  tenant: { portalEnabled: boolean; portalRemoteEnabled: boolean }
  shares: Share[]
  suggestions: Suggestion[]
}

const box: React.CSSProperties = {
  padding: "12px 14px",
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: 10,
  display: "flex",
  flexDirection: "column",
  gap: 10,
}
const input: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 12.5,
  background: "var(--color-background-primary, #fff)",
  color: "var(--color-text-primary)",
  border: "0.5px solid var(--color-border-secondary, #d4d4d8)",
  borderRadius: 6,
}
const btn = (primary?: boolean): React.CSSProperties => ({
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  border: primary ? "none" : "0.5px solid var(--color-border-tertiary)",
  background: primary ? "var(--color-accent, #F97316)" : "transparent",
  color: primary ? "#fff" : "var(--color-text-secondary)",
  cursor: "pointer",
})

export default function DeviceSharesCard({ deviceId, clientName, isAdmin }: { deviceId: string; clientName: string; isAdmin: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [email, setEmail] = useState("")
  const [note, setNote] = useState("")
  const [days, setDays] = useState<string>("")
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/devices/${deviceId}/shares`)
    if (r.ok) setData((await r.json()) as Payload)
    else setErr(`HTTP ${r.status}`)
  }, [deviceId])
  useEffect(() => {
    void load()
  }, [load])

  async function grant(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const expiresAt = days ? new Date(Date.now() + Number(days) * 86_400_000).toISOString() : null
      const r = await fetch(`/api/admin/devices/${deviceId}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ portalEmail: email, note, expiresAt }),
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        setErr(j.error ?? `HTTP ${r.status}`)
        return
      }
      setEmail("")
      setNote("")
      setDays("")
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function revoke(shareId: string, who: string) {
    if (!confirm(`Revoke remote access for ${who}?`)) return
    setBusy(true)
    try {
      await fetch(`/api/admin/devices/${deviceId}/shares`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareId }),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const gateOff = data && !(data.tenant.portalEnabled && data.tenant.portalRemoteEnabled)

  return (
    <section style={box}>
      <h2 style={{ fontSize: 12, fontWeight: 600, margin: 0, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Share with client (portal remote access)
      </h2>
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
        Portal users listed here get a <b>Remote access</b> button for this device on portal.pcc2k.com — it opens ControlR's viewer for this machine only, signed in as them, with no ControlR login. Every launch is audited.
      </p>
      {gateOff && (
        <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 6, background: "var(--color-warning-soft, rgba(245,158,11,0.12))", color: "var(--color-warning, #b45309)" }}>
          Inert until <b>{clientName}</b> has both <i>Portal enabled</i> and <i>Customer remote access</i> on (client → Settings → Customer portal).
        </div>
      )}

      {data && data.shares.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
          {data.shares.map((s) => (
            <li key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{s.portalEmail}</span>
                {!s.hasPortalLogin && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--color-warning, #b45309)" }}>no portal login yet</span>}
                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  granted by {s.grantedByEmail.split("@")[0]} {new Date(s.createdAt).toLocaleDateString()}
                  {s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleDateString()}` : ""}
                  {s.useCount ? ` · used ${s.useCount}× (last ${s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleDateString() : "—"})` : " · never used"}
                  {s.note ? ` · ${s.note}` : ""}
                </div>
              </div>
              {isAdmin && (
                <button type="button" disabled={busy} onClick={() => revoke(s.id, s.portalEmail)} style={btn()}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.shares.length === 0 && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Not shared with anyone.</div>}

      {isAdmin && (
        <form onSubmit={grant} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <input
            list={`share-suggest-${deviceId}`}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="portal user email"
            style={{ ...input, flex: "1 1 220px" }}
          />
          <datalist id={`share-suggest-${deviceId}`}>
            {data?.suggestions.map((s) => (
              <option key={s.email} value={s.email}>
                {s.name}
                {s.jobTitle ? ` — ${s.jobTitle}` : ""}
                {s.hasPortalLogin ? " (portal)" : ""}
              </option>
            ))}
          </datalist>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" style={{ ...input, flex: "1 1 160px" }} />
          <select value={days} onChange={(e) => setDays(e.target.value)} style={input}>
            <option value="">no expiry</option>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
          <button type="submit" disabled={busy || !email} style={btn(true)}>
            Share
          </button>
        </form>
      )}
      {err && <div style={{ fontSize: 12, color: "var(--color-danger, #b91c1c)" }}>{err}</div>}
    </section>
  )
}
