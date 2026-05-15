import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireSession } from "@/lib/authz"
import {
  listMspRollup,
  clientSlug,
  SIGNAL_FILTERS,
  SEVERITY_FILTERS,
  type MspRollupClient,
  type AttentionCard,
  type SignalFilter,
  type SeverityFilter,
} from "@/lib/msp-rollup"
import RefreshButton from "./RefreshButton"

export const dynamic = "force-dynamic"

// Phase 6 step 2 — the triage view. One row per managed client,
// sorted by composite risk score DESC. Step 4 added the "needs
// your attention" rail; step 5 added URL-state filters; step 7
// adds the TicketHub overlay column. Design: docs/PHASE-6-DESIGN.md §3.

const SIGNAL_LABELS: Record<SignalFilter, string> = {
  all: "All",
  alerts: "Alerts",
  offline: "Offline",
  patches: "Patches",
  deploys: "Deploys",
  scripts: "Scripts",
  schedules: "Schedules",
  audit: "Audit",
}
const SEVERITY_LABELS: Record<SeverityFilter, string> = {
  all: "All",
  "critical-only": "Critical only",
  "warn+": "Warn+",
  "info+": "Info+",
}

function parseSignal(raw: string | undefined): SignalFilter {
  return (SIGNAL_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as SignalFilter)
    : "all"
}
function parseSeverity(raw: string | undefined): SeverityFilter {
  return (SEVERITY_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as SeverityFilter)
    : "warn+"
}

function buildFilterQuery(opts: { signal: SignalFilter; severity: SeverityFilter }): string {
  const params = new URLSearchParams()
  if (opts.signal !== "all") params.set("signal", opts.signal)
  if (opts.severity !== "warn+") params.set("severity", opts.severity)
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export default async function MspTriagePage({
  searchParams,
}: {
  searchParams: Promise<{ signal?: string; severity?: string }>
}) {
  await requireSession()
  const sp = await searchParams
  const signal = parseSignal(sp.signal)
  const severity = parseSeverity(sp.severity)
  const rollup = await listMspRollup({ signal, severity })
  const totalOpenAlerts = rollup.clients.reduce((n, c) => n + c.alertsOpen, 0)
  const generatedAt = rollup.generatedAt.toISOString().slice(11, 19) // HH:MM:SS

  return (
    <AppShell openAlertsCount={totalOpenAlerts}>
      {/* CSS-only pulse for `triage <client>` from Cmd-K. The :target
          pseudo-class fires when the URL hash matches a row's id, no
          JS needed. Animation auto-decays in ~2.4s. */}
      <style>{`
        tr[id^="client-"]:target {
          animation: msp-row-pulse 2.4s ease-out;
        }
        @keyframes msp-row-pulse {
          0%   { background: rgba(249, 115, 22, 0.35); }
          70%  { background: rgba(249, 115, 22, 0.08); }
          100% { background: transparent; }
        }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Triage
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
              Every managed client on one row, sorted by who&rsquo;s on fire.
              Click any cell to drill into the action.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              Generated {generatedAt} UTC
            </span>
            <a
              href={`/msp/export.csv${buildFilterQuery({ signal, severity })}`}
              style={{
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-text-secondary)",
                background: "var(--color-background-secondary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              Export CSV
            </a>
            <RefreshButton />
          </div>
        </header>

        <FilterBar signal={signal} severity={severity} inScopeClientCount={rollup.inScopeClientCount} />

        {rollup.attentionRail.length > 0 && (
          <AttentionRail cards={rollup.attentionRail} />
        )}

        {rollup.clients.length === 0 ? (
          <EmptyState signalFiltered={signal !== "all"} />
        ) : (
          <TriageTable
            clients={rollup.clients}
            ticketHubAvailable={rollup.ticketHubAvailable}
            ticketHubPublicUrl={rollup.ticketHubPublicUrl}
          />
        )}
      </div>
    </AppShell>
  )
}

// ─── Filter bar ──────────────────────────────────────────────────────────

function FilterBar({
  signal,
  severity,
  inScopeClientCount,
}: {
  signal: SignalFilter
  severity: SeverityFilter
  inScopeClientCount: number
}) {
  return (
    <section
      aria-label="Triage filters"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        display: "flex",
        flexWrap: "wrap",
        gap: "14px",
        padding: "8px 10px",
        background: "var(--color-background-primary, #fff)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "8px",
      }}
    >
      <FilterRow
        label="Signal"
        options={SIGNAL_FILTERS}
        labels={SIGNAL_LABELS}
        current={signal}
        otherParam={["severity", severity]}
        defaultValue="all"
      />
      <FilterRow
        label="Severity"
        options={SEVERITY_FILTERS}
        labels={SEVERITY_LABELS}
        current={severity}
        otherParam={["signal", signal]}
        defaultValue="warn+"
      />
      <span
        style={{
          marginLeft: "auto",
          alignSelf: "center",
          fontSize: "11px",
          color: "var(--color-text-muted)",
        }}
      >
        {inScopeClientCount} client{inScopeClientCount === 1 ? "" : "s"} in scope
      </span>
    </section>
  )
}

function FilterRow<T extends string>({
  label,
  options,
  labels,
  current,
  otherParam,
  defaultValue,
}: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  current: T
  otherParam: [string, string]
  defaultValue: T
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginRight: "2px",
        }}
      >
        {label}
      </span>
      {options.map((opt) => {
        const active = opt === current
        const params = new URLSearchParams()
        if (otherParam[1] && otherParam[1] !== "all" && otherParam[1] !== "warn+") {
          params.set(otherParam[0], otherParam[1])
        }
        if (opt !== defaultValue) {
          const key = label === "Signal" ? "signal" : "severity"
          params.set(key, opt)
        }
        const qs = params.toString()
        const href = qs ? `/msp?${qs}` : `/msp`
        return (
          <Link
            key={opt}
            href={href}
            style={{
              padding: "3px 9px",
              fontSize: "11.5px",
              fontWeight: active ? 600 : 500,
              color: active ? "#fff" : "var(--color-text-secondary)",
              background: active ? "var(--color-accent, #F97316)" : "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "999px",
              textDecoration: "none",
            }}
          >
            {labels[opt]}
          </Link>
        )
      })}
    </div>
  )
}

// ─── Attention rail ──────────────────────────────────────────────────────

function AttentionRail({ cards }: { cards: AttentionCard[] }) {
  return (
    <section
      aria-label="Needs your attention"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "10px",
      }}
    >
      {cards.map((c) => <AttentionCardView key={c.kind} card={c} />)}
    </section>
  )
}

function AttentionCardView({ card }: { card: AttentionCard }) {
  const tone =
    card.tone === "bad" ? {
      border: "var(--color-danger, #b91c1c)",
      bg: "var(--color-danger-soft, rgba(239, 68, 68, 0.08))",
      label: "var(--color-danger, #b91c1c)",
    } : card.tone === "kev" ? {
      border: "var(--color-kev, #7f1d1d)",
      bg: "rgba(127, 29, 29, 0.08)",
      label: "var(--color-kev, #7f1d1d)",
    } : {
      border: "var(--color-warning, #b45309)",
      bg: "var(--color-warning-soft, rgba(234, 179, 8, 0.1))",
      label: "var(--color-warning, #b45309)",
    }
  return (
    <Link
      href={card.href}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "10px 12px",
        background: tone.bg,
        border: `0.5px solid ${tone.border}`,
        borderRadius: "8px",
        textDecoration: "none",
        color: "var(--color-text-primary)",
      }}
    >
      <div
        style={{
          fontSize: "9.5px",
          fontWeight: 600,
          color: tone.label,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {card.title}
      </div>
      <div style={{ fontSize: "16px", fontWeight: 700, color: tone.label }}>
        {card.value}
      </div>
      <div
        style={{
          fontSize: "11px",
          color: "var(--color-text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {card.context}
      </div>
    </Link>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────

function TriageTable({
  clients,
  ticketHubAvailable,
  ticketHubPublicUrl,
}: {
  clients: MspRollupClient[]
  ticketHubAvailable: boolean
  ticketHubPublicUrl: string
}) {
  return (
    <div
      style={{
        overflowX: "auto",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
      }}
    >
      <table
        style={{
          width: "100%",
          minWidth: ticketHubAvailable ? 1200 : 1100,
          borderCollapse: "collapse",
          fontSize: "12.5px",
        }}
      >
        <thead>
          <tr style={{ background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))" }}>
            <Th align="left">Client</Th>
            <Th align="right">Risk</Th>
            <Th align="right">Devices</Th>
            <Th align="right">Offline&nbsp;&gt;24h</Th>
            <Th align="right">Alerts</Th>
            <Th align="right">Patches&nbsp;behind</Th>
            <Th align="right">Max&nbsp;CVSS</Th>
            <Th align="right">KEV</Th>
            <Th align="right">Stuck&nbsp;deploys</Th>
            <Th align="right">Failed&nbsp;scripts</Th>
            <Th align="right">Schedule</Th>
            <Th align="center">Audit</Th>
            {ticketHubAvailable && <Th align="right">Tickets</Th>}
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <Row
              key={c.name}
              client={c}
              ticketHubAvailable={ticketHubAvailable}
              ticketHubPublicUrl={ticketHubPublicUrl}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({
  client,
  ticketHubAvailable,
  ticketHubPublicUrl,
}: {
  client: MspRollupClient
  ticketHubAvailable: boolean
  ticketHubPublicUrl: string
}) {
  const enc = encodeURIComponent(client.name)
  const deviceTone: Tone =
    client.deviceTotal === 0 ? "neutral"
      : client.deviceOnline === client.deviceTotal ? "ok"
      : client.deviceOnline >= Math.ceil(client.deviceTotal * 0.8) ? "warn"
      : "bad"
  const offlineTone: Tone = client.deviceOfflineOver24h > 0 ? "bad" : "neutral"
  const alertTone: Tone =
    client.alertsCritical > 0 ? "bad"
      : client.alertsOpen > 0 ? "warn"
      : "neutral"
  const cvssTone: Tone =
    client.oldestUnpatchedCvss == null ? "neutral"
      : client.oldestUnpatchedCvss >= 9 ? "bad"
      : client.oldestUnpatchedCvss >= 7 ? "warn"
      : "neutral"
  const kevTone: Tone = client.kevCveUnpatched > 0 ? "kev" : "neutral"
  const stuckTone: Tone = client.stuckDeploys > 0 ? "warn" : "neutral"
  const scriptTone: Tone = client.failedScripts24h > 0 ? "warn" : "neutral"
  const scheduleTone: Tone =
    client.scheduleStalenessMs == null ? "neutral"
      : client.scheduleStalenessMs > 24 * 60 * 60 * 1000 ? "bad"
      : client.scheduleStalenessMs > 6 * 60 * 60 * 1000 ? "warn"
      : "ok"
  const auditTone: Tone = client.auditChainStatus === "broken-here" ? "bad" : "neutral"

  return (
    <tr
      id={`client-${clientSlug(client.name)}`}
      style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}
    >
      <Td align="left">
        <Link
          href={`/clients/${enc}`}
          style={{
            color: "var(--color-text-primary)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {client.name}
          {client.pending && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                fontSize: "9.5px",
                fontWeight: 600,
                borderRadius: 999,
                background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.18))",
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              pending
            </span>
          )}
        </Link>
      </Td>
      <Td align="right">
        <Link href={`/clients/${enc}`} style={cellLinkStyle(scoreTone(client.riskScore))}>
          {client.riskScore}
        </Link>
      </Td>
      <Td align="right">
        {client.deviceTotal === 0 ? dim() : (
          <Link href={`/clients/${enc}?tab=devices`} style={cellLinkStyle(deviceTone)}>
            {client.deviceOnline}/{client.deviceTotal}
          </Link>
        )}
      </Td>
      <Td align="right">
        {client.deviceOfflineOver24h === 0 ? dim() : (
          <Link href={`/clients/${enc}?tab=devices&filter=offline-24h`} style={cellLinkStyle(offlineTone)}>
            {client.deviceOfflineOver24h}
          </Link>
        )}
      </Td>
      <Td align="right">
        {client.alertsOpen === 0 ? dim() : (
          <Link href={`/clients/${enc}?tab=alerts`} style={cellLinkStyle(alertTone)}>
            {client.alertsOpen}
            {client.alertsCritical > 0 && (
              <span style={{ marginLeft: 4, fontSize: "10px", color: TONE_COLOR.bad }}>
                ({client.alertsCritical}!)
              </span>
            )}
          </Link>
        )}
      </Td>
      <Td align="right">
        {client.hostsBehindPatch === 0 ? dim() : (
          <Link href={`/clients/${enc}?tab=patches`} style={cellLinkStyle("warn")}>
            {client.hostsBehindPatch}
          </Link>
        )}
      </Td>
      <Td align="right">
        {client.oldestUnpatchedCvss == null ? dim() : (
          <Link href={`/patches?client=${enc}&sort=cvss-desc`} style={cellLinkStyle(cvssTone)}>
            {client.oldestUnpatchedCvss.toFixed(1)}
          </Link>
        )}
      </Td>
      <Td align="right">
        {client.kevCveUnpatched === 0 ? dim() : (
          <Link href={`/patches?client=${enc}&kev=true`} style={cellLinkStyle(kevTone)}>
            {client.kevCveUnpatched}
          </Link>
        )}
      </Td>
      <Td align="right">
        {client.stuckDeploys === 0 ? dim() : (
          <Link href={`/deployments?client=${enc}&state=stuck`} style={cellLinkStyle(stuckTone)}>
            {client.stuckDeploys}
          </Link>
        )}
      </Td>
      <Td align="right">
        {client.failedScripts24h === 0 ? dim() : (
          <Link href={`/runs?client=${enc}&state=failed`} style={cellLinkStyle(scriptTone)}>
            {client.failedScripts24h}
          </Link>
        )}
      </Td>
      <Td align="right">
        {client.scheduleCount === 0 ? dim() :
          client.scheduleStalenessMs == null ? (
            <Link href={`/reports/scheduled?client=${enc}`} style={cellLinkStyle("neutral")}>
              never fired
            </Link>
          ) : (
            <Link href={`/reports/scheduled?client=${enc}`} style={cellLinkStyle(scheduleTone)}>
              {formatAge(client.scheduleStalenessMs)}
            </Link>
          )
        }
      </Td>
      <Td align="center">
        <Link href={`/audit?client=${enc}`} style={cellLinkStyle(auditTone)}>
          {client.auditChainStatus === "broken-here" ? "BROKEN HERE" : "ok"}
        </Link>
      </Td>
      {ticketHubAvailable && (
        <Td align="right">
          {client.openTickets == null || client.openTickets === 0 ? dim() : (
            <a
              href={`${ticketHubPublicUrl}/tickets?client=${enc}`}
              target="_blank"
              rel="noopener noreferrer"
              style={cellLinkStyle(client.openTickets >= 5 ? "bad" : client.openTickets >= 2 ? "warn" : "neutral")}
            >
              {client.openTickets}
            </a>
          )}
        </Td>
      )}
    </tr>
  )
}

// ─── Cell primitives ──────────────────────────────────────────────────────

type Tone = "neutral" | "ok" | "warn" | "bad" | "kev"
const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--color-text-primary)",
  ok:      "var(--color-success, #15803d)",
  warn:    "var(--color-warning, #b45309)",
  bad:     "var(--color-danger, #b91c1c)",
  kev:     "var(--color-kev, #7f1d1d)",
}

function cellLinkStyle(tone: Tone): React.CSSProperties {
  return {
    color: TONE_COLOR[tone],
    fontWeight: tone === "neutral" ? 500 : 600,
    textDecoration: "none",
  }
}

function scoreTone(score: number): Tone {
  if (score >= 30) return "bad"
  if (score >= 10) return "warn"
  if (score > 0)   return "ok"
  return "neutral"
}

function dim() {
  return <span style={{ color: "var(--color-text-muted)" }}>—</span>
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return (
    <th
      style={{
        padding: "8px 10px",
        textAlign: align,
        fontSize: "10px",
        fontWeight: 600,
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return (
    <td style={{ padding: "8px 10px", textAlign: align, whiteSpace: "nowrap" }}>
      {children}
    </td>
  )
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState({ signalFiltered }: { signalFiltered: boolean }) {
  if (signalFiltered) {
    return (
      <div
        style={{
          padding: "40px",
          textAlign: "center",
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "10px",
          color: "var(--color-text-muted)",
          fontSize: "13px",
        }}
      >
        No clients with values in the chosen signal.{" "}
        <Link href="/msp" style={{ color: "var(--color-accent, #F97316)", fontWeight: 600 }}>
          Clear filter
        </Link>
        {" "}to see the full fleet.
      </div>
    )
  }
  return (
    <div
      style={{
        padding: "40px",
        textAlign: "center",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
        color: "var(--color-text-muted)",
        fontSize: "13px",
      }}
    >
      No managed clients yet. Add one from{" "}
      <Link href="/clients/new" style={{ color: "var(--color-accent, #F97316)", fontWeight: 600 }}>
        Clients &rsaquo; + New client
      </Link>
      , or wait for the first agent to enroll.
    </div>
  )
}
