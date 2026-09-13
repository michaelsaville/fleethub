"use client"
import { useEffect, useMemo, useState, useTransition } from "react"
import { markRemoteSessionClosed, saveSessionNotes } from "@/app/(protected)/remote-sessions/actions"
import type { SessionWorkspaceData } from "@/lib/session-workspace"
import PowerButton from "@/components/PowerButton"

// The Datto-style session window: context rail on the left (device, client
// & contacts, tickets, notes, session), the ControlR viewer on the right.
// The rail is FleetHub/TicketHub data; the viewer is an iframe of ControlR's
// device-access page (nginx allows framing from fleethub.pcc2k.com).

type Data = SessionWorkspaceData

const rail: React.CSSProperties = {
  width: 340,
  minWidth: 340,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  overflowY: "auto",
  background: "var(--color-background-secondary, #0f172a)",
  borderRight: "0.5px solid var(--color-border-tertiary, #334155)",
  color: "var(--color-text-primary, #e2e8f0)",
  fontSize: 12.5,
}
const card: React.CSSProperties = {
  background: "var(--color-background-primary, #111827)",
  border: "0.5px solid var(--color-border-tertiary, #334155)",
  borderRadius: 8,
  padding: "10px 12px",
}
const h: React.CSSProperties = {
  margin: "0 0 6px",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--color-text-muted, #94a3b8)",
}
const muted: React.CSSProperties = { color: "var(--color-text-muted, #94a3b8)" }
const link: React.CSSProperties = { color: "var(--color-accent, #F97316)", textDecoration: "none" }
const btn = (primary?: boolean): React.CSSProperties => ({
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  border: primary ? "none" : "0.5px solid var(--color-border-tertiary, #334155)",
  background: primary ? "var(--color-accent, #F97316)" : "transparent",
  color: primary ? "#fff" : "var(--color-text-primary, #e2e8f0)",
  cursor: "pointer",
})

function tel(n: string | null | undefined) {
  if (!n) return null
  const digits = n.replace(/[^\d+]/g, "")
  return digits ? `tel:${digits}` : null
}

function Elapsed({ since, until }: { since: string; until: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  const ms = (until ? new Date(until).getTime() : now) - new Date(since).getTime()
  const s = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{hh > 0 ? `${hh}:` : ""}{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}</span>
}

export default function SessionWorkspace({ data, operatorEmail }: { data: Data; operatorEmail: string }) {
  const { session, device, client, previous, viewerUrl, viewerError, live } = data
  const [railOpen, setRailOpen] = useState(true)
  const [notes, setNotes] = useState(session.notes)
  const [ticketId, setTicketId] = useState<string>(session.notesTicketId ?? "")
  const [msg, setMsg] = useState<string | null>(null)
  const [ended, setEnded] = useState(!live)
  const [pending, start] = useTransition()

  const dirty = notes !== session.notes
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", onUnload)
    return () => window.removeEventListener("beforeunload", onUnload)
  }, [dirty])

  function save(post: boolean) {
    setMsg(null)
    start(async () => {
      const r = await saveSessionNotes({ sessionId: session.id, notes, ticketId: post ? ticketId || null : null })
      if (!r.ok) setMsg(r.error ?? "Failed")
      else setMsg(r.postedToTicket ? `Saved and posted to #TH-${r.postedToTicket}` : "Saved")
    })
  }

  function endSession() {
    if (!confirm("End this remote session? The viewer will close.")) return
    start(async () => {
      if (dirty) await saveSessionNotes({ sessionId: session.id, notes, ticketId: null })
      const fd = new FormData()
      fd.append("sessionId", session.id)
      await markRemoteSessionClosed(fd)
      setEnded(true)
      setMsg("Session closed")
    })
  }

  const primaryContacts = useMemo(() => client?.contacts.slice(0, 5) ?? [], [client])
  const deviceTickets = client?.tickets.filter((t) => t.onDevice) ?? []
  const otherTickets = client?.tickets.filter((t) => !t.onDevice) ?? []

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", background: "#0b1220" }}>
      {railOpen && (
        <aside style={rail} aria-label="Session context">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a href={`/devices/${device.id}`} style={{ ...link, fontSize: 11 }}>← device</a>
            <span style={{ flex: 1 }} />
            <span style={{ ...muted, fontSize: 11 }}>
              {ended ? "closed" : "live"} · <Elapsed since={session.startedAt} until={ended ? (session.endedAt ?? new Date().toISOString()) : null} />
            </span>
            <button type="button" onClick={() => setRailOpen(false)} title="Hide panel" style={{ ...btn(), padding: "2px 8px" }}>
              ⟨
            </button>
          </div>

          <section style={card}>
            <div style={h}>Device</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {device.hostname}
              {device.friendlyName && <span style={{ ...muted, fontWeight: 400 }}> · {device.friendlyName}</span>}
            </div>
            <div style={muted}>
              <span style={{ color: device.isOnline ? "#22c55e" : "#f59e0b" }}>●</span> {device.isOnline ? "online" : "offline"}
              {device.osVersion ? ` · ${device.osVersion}` : device.os ? ` · ${device.os}` : ""}
              {device.role ? ` · ${device.role}` : ""}
            </div>
            <dl style={{ margin: "6px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
              {device.ipAddress && (<><dt style={muted}>IP</dt><dd style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}>{device.ipAddress}</dd></>)}
              {device.hardware && (<><dt style={muted}>Model</dt><dd style={{ margin: 0 }}>{device.hardware.manufacturer} {device.hardware.model}</dd></>)}
              {device.hardware?.serial && (<><dt style={muted}>Serial</dt><dd style={{ margin: 0, fontFamily: "ui-monospace, monospace" }}>{device.hardware.serial}</dd></>)}
              {device.hardware && (<><dt style={muted}>RAM/Disk</dt><dd style={{ margin: 0 }}>{device.hardware.ramGb} GB · {device.hardware.diskFreeGb}/{device.hardware.diskGb} GB free</dd></>)}
              {device.osInfo?.lastBootAt && (<><dt style={muted}>Last boot</dt><dd style={{ margin: 0 }}>{new Date(device.osInfo.lastBootAt).toLocaleString()}</dd></>)}
              {device.patches && (<><dt style={muted}>Patches</dt><dd style={{ margin: 0 }}>{device.patches.pending} pending{device.patches.failed ? `, ${device.patches.failed} failed` : ""}</dd></>)}
              {device.assetTag && (<><dt style={muted}>Asset</dt><dd style={{ margin: 0 }}>{device.assetTag}</dd></>)}
              {device.alertCount > 0 && (<><dt style={muted}>Alerts</dt><dd style={{ margin: 0, color: "#f59e0b" }}>{device.alertCount} open</dd></>)}
            </dl>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <PowerButton deviceId={device.id} online={device.isOnline} hasAgent={device.hasAgent} />
              <a href={`/devices/${device.id}?tab=scripts`} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: "none" }}>Scripts</a>
            </div>
          </section>

          <section style={card}>
            <div style={h}>Client</div>
            {client ? (
              <>
                <div style={{ fontWeight: 600 }}>
                  <a href={`${client.ticketHubUrl}/clients/${client.id}`} target="_blank" rel="noreferrer" style={{ ...link, color: "inherit" }}>{client.name}</a>
                  {client.shortCode && <span style={muted}> · {client.shortCode}</span>}
                </div>
                {(client.street || client.city) && (
                  <div style={muted}>{[client.street, [client.city, client.state].filter(Boolean).join(", "), client.zip].filter(Boolean).join(" · ")}</div>
                )}
                {client.businessHoursStart && <div style={muted}>Hours {client.businessHoursStart}–{client.businessHoursEnd}</div>}
                <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {primaryContacts.map((c) => {
                    const n = c.mobilePhone || c.phone || c.officePhone
                    return (
                      <li key={c.id}>
                        <div>
                          {c.firstName} {c.lastName}
                          {c.isPrimary && <span style={{ ...muted, fontSize: 10.5 }}> · primary</span>}
                          {c.isHelpdesk && <span style={{ ...muted, fontSize: 10.5 }}> · helpdesk</span>}
                          {c.jobTitle && <span style={{ ...muted, fontSize: 10.5 }}> · {c.jobTitle}</span>}
                        </div>
                        <div style={{ ...muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {n && <a href={tel(n) ?? undefined} style={link}>{n}{c.officePhoneExt && n === c.officePhone ? ` x${c.officePhoneExt}` : ""}</a>}
                          {c.afterHoursPhone && <a href={tel(c.afterHoursPhone) ?? undefined} style={link}>after-hrs {c.afterHoursPhone}</a>}
                          {c.email && <a href={`mailto:${c.email}`} style={link}>{c.email}</a>}
                        </div>
                      </li>
                    )
                  })}
                  {primaryContacts.length === 0 && <li style={muted}>No contacts on file.</li>}
                </ul>
              </>
            ) : (
              <div style={muted}>No TicketHub client named “{device.clientName}”.</div>
            )}
          </section>

          <section style={card}>
            <div style={{ ...h, display: "flex", alignItems: "center" }}>
              <span>Tickets</span>
              <span style={{ flex: 1 }} />
              {client && (
                <a href={client.newTicketUrl} target="_blank" rel="noreferrer" style={{ ...link, textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>+ New ticket</a>
              )}
            </div>
            {client && client.tickets.length === 0 && <div style={muted}>No open tickets for this client.</div>}
            {[...deviceTickets, ...otherTickets].map((t) => (
              <div key={t.id} style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "3px 0", borderTop: "0.5px solid var(--color-border-tertiary, #334155)" }}>
                <a href={`${client!.ticketHubUrl}/tickets/${t.id}`} target="_blank" rel="noreferrer" style={{ ...link, fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>#{t.ticketNumber}</a>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.title}>
                  {t.onDevice && <span title="linked to this device">🖥 </span>}{t.title}
                </span>
                <span style={{ ...muted, fontSize: 10.5 }}>{t.status.toLowerCase().replace(/_/g, " ")}</span>
              </div>
            ))}
          </section>

          <section style={card}>
            <div style={h}>Session notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              placeholder="What you did, what you found, what's left…"
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", background: "transparent", color: "inherit", border: "0.5px solid var(--color-border-tertiary, #334155)", borderRadius: 6, padding: 8, fontSize: 12.5, fontFamily: "inherit" }}
            />
            {client && client.tickets.length > 0 && (
              <select value={ticketId} onChange={(e) => setTicketId(e.target.value)} style={{ marginTop: 6, width: "100%", background: "transparent", color: "inherit", border: "0.5px solid var(--color-border-tertiary, #334155)", borderRadius: 6, padding: 6, fontSize: 12 }}>
                <option value="">— post to a ticket (optional) —</option>
                {client.tickets.map((t) => (
                  <option key={t.id} value={t.id} style={{ color: "#000" }}>
                    #{t.ticketNumber} {t.title.slice(0, 50)}
                  </option>
                ))}
              </select>
            )}
            <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" disabled={pending || !dirty} onClick={() => save(false)} style={btn()}>Save</button>
              <button type="button" disabled={pending || !notes.trim() || !ticketId} onClick={() => save(true)} style={btn(true)}>Save & post to ticket</button>
              <span style={{ ...muted, fontSize: 11, flex: 1 }}>{msg}</span>
            </div>
          </section>

          <section style={card}>
            <div style={h}>Session</div>
            <div style={muted}>{operatorEmail} · via {session.provider === "controlr" ? "ControlR" : "RustDesk"}</div>
            {session.justification && <div style={{ marginTop: 4 }}>“{session.justification}”</div>}
            <div style={{ marginTop: 8 }}>
              {!ended ? (
                <button type="button" disabled={pending} onClick={endSession} style={{ ...btn(), borderColor: "#ef4444", color: "#fca5a5" }}>End session</button>
              ) : (
                <span style={muted}>Closed{session.endedAt ? ` ${new Date(session.endedAt).toLocaleTimeString()}` : ""}.</span>
              )}
            </div>
            {previous.length > 0 && (
              <>
                <div style={{ ...h, marginTop: 10 }}>Previous sessions</div>
                {previous.map((p) => (
                  <div key={p.id} style={{ ...muted, fontSize: 11.5, padding: "2px 0" }}>
                    {p.startedAt ? new Date(p.startedAt).toLocaleDateString() : "—"} · {p.operatorEmail.split("@")[0]} · {p.state}
                    {p.notes && <div style={{ color: "var(--color-text-primary, #e2e8f0)", whiteSpace: "pre-wrap" }}>{p.notes.slice(0, 160)}{p.notes.length > 160 ? "…" : ""}</div>}
                  </div>
                ))}
              </>
            )}
          </section>
        </aside>
      )}

      <main style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {!railOpen && (
          <button type="button" onClick={() => setRailOpen(true)} title="Show panel" style={{ ...btn(true), position: "absolute", left: 8, top: 8, zIndex: 2, padding: "4px 10px" }}>
            ⟩ {device.hostname}
          </button>
        )}
        {ended ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontFamily: "system-ui" }}>
            Session closed. <a href={`/devices/${device.id}`} style={{ ...link, marginLeft: 8 }}>Back to device</a>
          </div>
        ) : viewerUrl ? (
          <iframe
            src={viewerUrl}
            title={`Remote control — ${device.hostname}`}
            allow="clipboard-read; clipboard-write; fullscreen"
            style={{ width: "100%", height: "100%", border: 0, background: "#000" }}
          />
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fca5a5", fontFamily: "system-ui", padding: 24, textAlign: "center" }}>
            {viewerError ?? (device.controlrLinked ? "No viewer for this session." : "This device isn't enrolled in ControlR.")}
          </div>
        )}
      </main>
    </div>
  )
}
