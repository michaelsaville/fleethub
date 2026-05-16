import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireSession } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { relativeLastSeen } from "@/lib/devices-time"
import { rustDeskMode } from "@/lib/rustdesk"
import { Chip } from "@/components/ui/Chip"
import type { Tone } from "@/lib/ui-tokens"

export const dynamic = "force-dynamic"

// Phase 7 Workstream C step 3 — fleet-wide remote session list.
// Active + recent. Filterable by client + state + operator via
// URL query params (no client-side state machine — same pattern
// the /msp page uses).

interface SearchParams {
  client?: string
  state?: string
  operator?: string
}

const STATE_FILTERS = ["all", "in-progress", "closed", "expired", "revoked"] as const

export default async function RemoteSessionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireSession()
  const sp = await searchParams
  const stateFilter = (STATE_FILTERS as readonly string[]).includes(sp.state ?? "")
    ? (sp.state as (typeof STATE_FILTERS)[number])
    : "all"
  const clientFilter = sp.client?.trim() || ""
  const operatorFilter = sp.operator?.trim() || ""
  const mode = rustDeskMode()

  // Pull last 300 sessions matching the filters. Cheap at MSP
  // scale; if it ever grows past ~10k sessions we add pagination.
  const sessions = await prisma.fl_RemoteSession.findMany({
    where: {
      ...(stateFilter !== "all" ? { state: stateFilter } : {}),
      ...(operatorFilter ? { operatorEmail: { contains: operatorFilter, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true, deviceId: true, state: true, operatorEmail: true,
      justification: true, startedAt: true, endedAt: true,
      bytesTransferred: true, assertedClose: true, rustdeskSessionId: true,
    },
  })
  const deviceIds = [...new Set(sessions.map((s) => s.deviceId))]
  const devices = await prisma.fl_Device.findMany({
    where: { id: { in: deviceIds } },
    select: { id: true, hostname: true, clientName: true },
  })
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const filtered = clientFilter
    ? sessions.filter((s) => deviceById.get(s.deviceId)?.clientName === clientFilter)
    : sessions
  const activeCount = filtered.filter((s) => s.state === "in-progress").length

  // Distinct clients seen in the result set for the filter pill row.
  const seenClients = [...new Set(filtered.map((s) => deviceById.get(s.deviceId)?.clientName).filter((x): x is string => !!x))].sort()

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Remote sessions
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: 720 }}>
              Every operator-driven remote-control session, fleet-wide.
              {activeCount > 0 && (
                <strong style={{ color: "var(--color-success, #15803d)", marginLeft: 6 }}>
                  {activeCount} active.
                </strong>
              )}
            </p>
          </div>
          <span style={{
            padding: "3px 10px", fontSize: 11, fontWeight: 600,
            background: mode === "pro" ? "var(--color-success-soft, rgba(21, 128, 61, 0.15))" : "var(--color-background-tertiary, rgba(148, 163, 184, 0.18))",
            color: mode === "pro" ? "var(--color-success, #15803d)" : "var(--color-text-muted)",
            borderRadius: 999, textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            RustDesk mode: {mode}
          </span>
        </header>

        <FilterBar stateFilter={stateFilter} clientFilter={clientFilter} operatorFilter={operatorFilter} seenClients={seenClients} />

        {filtered.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, color: "var(--color-text-muted)", fontSize: 13 }}>
            No remote sessions match the current filter.
          </div>
        ) : (
          <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: "12.5px" }}>
              <thead>
                <tr style={{ background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))" }}>
                  <Th align="left">Started</Th>
                  <Th align="left">Device</Th>
                  <Th align="left">Operator</Th>
                  <Th align="center">State</Th>
                  <Th align="left">Justification</Th>
                  <Th align="right">Bytes</Th>
                  <Th align="left">Closed</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const dev = deviceById.get(s.deviceId)
                  return (
                    <tr key={s.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      <Td align="left">
                        {s.startedAt ? relativeLastSeen(s.startedAt) : "—"}
                        <br />
                        <span style={{ fontSize: 10.5, color: "var(--color-text-muted)" }}>
                          {s.startedAt?.toISOString().slice(0, 16).replace("T", " ")}
                        </span>
                      </Td>
                      <Td align="left">
                        {dev ? (
                          <Link href={`/devices/${dev.id}?tab=remote`} style={{ color: "var(--color-text-primary)", textDecoration: "none" }}>
                            {dev.hostname}
                            <br />
                            <span style={{ fontSize: 10.5, color: "var(--color-text-muted)" }}>{dev.clientName}</span>
                          </Link>
                        ) : <span style={{ color: "var(--color-text-muted)" }}>(deleted)</span>}
                      </Td>
                      <Td align="left">{s.operatorEmail}</Td>
                      <Td align="center">{stateChip(s.state)}</Td>
                      <Td align="left">
                        {s.justification ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                      </Td>
                      <Td align="right">
                        {s.bytesTransferred != null
                          ? <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>{humanBytes(Number(s.bytesTransferred))}</code>
                          : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                      </Td>
                      <Td align="left">
                        {s.endedAt ? (
                          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                            {relativeLastSeen(s.endedAt)} · {s.assertedClose ? "operator" : "rustdesk"}
                          </span>
                        ) : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ─── Filter bar ──────────────────────────────────────────────────────────

function FilterBar({ stateFilter, clientFilter, operatorFilter, seenClients }: {
  stateFilter: (typeof STATE_FILTERS)[number]
  clientFilter: string
  operatorFilter: string
  seenClients: string[]
}) {
  function makeHref(over: Partial<{ state: string; client: string; operator: string }>): string {
    const params = new URLSearchParams()
    const s = over.state ?? stateFilter
    const c = over.client ?? clientFilter
    const o = over.operator ?? operatorFilter
    if (s && s !== "all") params.set("state", s)
    if (c) params.set("client", c)
    if (o) params.set("operator", o)
    const qs = params.toString()
    return qs ? `/remote-sessions?${qs}` : `/remote-sessions`
  }
  return (
    <section style={{
      display: "flex", flexWrap: "wrap", gap: 12,
      padding: "8px 10px",
      background: "var(--color-background-primary, #fff)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>State</span>
        {STATE_FILTERS.map((s) => {
          const active = s === stateFilter
          return (
            <Link key={s} href={makeHref({ state: s })} style={chipStyle(active)}>
              {s.replace(/-/g, " ")}
            </Link>
          )
        })}
      </div>
      {seenClients.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Client</span>
          <Link href={makeHref({ client: "" })} style={chipStyle(!clientFilter)}>all</Link>
          {seenClients.map((c) => (
            <Link key={c} href={makeHref({ client: c })} style={chipStyle(clientFilter === c)}>
              {c}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

// Filter-row chip — distinct from the table-cell <Chip> because
// filter chips function as toggleable buttons (URL-state),
// whereas table chips are pure status badges. Active state uses
// the accent color for affordance.
function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "3px 9px",
    fontSize: 11.5,
    fontWeight: active ? 600 : 500,
    color: active ? "#fff" : "var(--color-text-secondary)",
    background: active ? "var(--color-accent)" : "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--radius-full)",
    textDecoration: "none",
  }
}

function stateChip(state: string): React.ReactNode {
  const tone: Tone =
    state === "in-progress" ? "ok" :
    state === "expired" ? "warn" :
    state === "revoked" ? "bad" :
    "neutral"
  return <Chip tone={tone}>{state}</Chip>
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return <th style={{ padding: "8px 12px", textAlign: align, fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{children}</th>
}
function Td({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return <td style={{ padding: "8px 12px", textAlign: align, verticalAlign: "top" }}>{children}</td>
}
