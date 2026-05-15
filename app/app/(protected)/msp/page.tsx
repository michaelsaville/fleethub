import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireSession } from "@/lib/authz"
import { listMspRollup, type MspRollupClient } from "@/lib/msp-rollup"
import RefreshButton from "./RefreshButton"

export const dynamic = "force-dynamic"

// Phase 6 step 2 — the triage view. One row per managed client,
// sorted by composite risk score DESC. Step 4 adds the "needs your
// attention" rail; step 5 adds filters; step 7 adds the TicketHub
// overlay column. Design: docs/PHASE-6-DESIGN.md §3.

export default async function MspTriagePage() {
  await requireSession()
  const rollup = await listMspRollup()
  const totalOpenAlerts = rollup.clients.reduce((n, c) => n + c.alertsOpen, 0)
  const generatedAt = rollup.generatedAt.toISOString().slice(11, 19) // HH:MM:SS

  return (
    <AppShell openAlertsCount={totalOpenAlerts}>
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
            <RefreshButton />
          </div>
        </header>

        {!rollup.auditChain.intact && rollup.auditChain.firstBadRow && (
          <Link
            href={`/audit${
              rollup.auditChain.firstBadRow.clientName
                ? `?client=${encodeURIComponent(rollup.auditChain.firstBadRow.clientName)}`
                : ""
            }`}
            style={{
              display: "block",
              padding: "10px 12px",
              background: "var(--color-danger-soft, rgba(239, 68, 68, 0.1))",
              border: "0.5px solid var(--color-danger, #b91c1c)",
              borderRadius: "8px",
              color: "var(--color-danger, #b91c1c)",
              fontSize: "12px",
              textDecoration: "none",
            }}
          >
            <strong>Audit chain integrity broken</strong> at row {rollup.auditChain.firstBadRow.index + 1}
            {" "}({rollup.auditChain.firstBadRow.reason}). First-bad-row owner:
            {" "}
            <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
              {rollup.auditChain.firstBadRow.clientName ?? "—"}
            </code>
            . Click to investigate.
          </Link>
        )}

        {rollup.clients.length === 0 ? (
          <EmptyState />
        ) : (
          <TriageTable clients={rollup.clients} />
        )}
      </div>
    </AppShell>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────

function TriageTable({ clients }: { clients: MspRollupClient[] }) {
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
          minWidth: 1100,
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
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => <Row key={c.name} client={c} />)}
        </tbody>
      </table>
    </div>
  )
}

function Row({ client }: { client: MspRollupClient }) {
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
    <tr style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
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

function EmptyState() {
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
