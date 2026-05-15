import { NextRequest, NextResponse } from "next/server"
import { getSessionContext } from "@/lib/authz"
import {
  listMspRollup,
  SIGNAL_FILTERS,
  SEVERITY_FILTERS,
  type SignalFilter,
  type SeverityFilter,
  type MspRollupClient,
} from "@/lib/msp-rollup"

// Phase 6 step 9 — /msp/export.csv. Same row set the dashboard
// renders, in machine-friendly form, for cron-fed "daily fleet
// posture" emails-to-self or other monitoring scrapers. Accepts
// either a NextAuth session (so an operator can hit the same URL
// from a browser tab) or a FLEETHUB_AGENT_SECRET bearer (so a
// crontab line works without a logged-in session).
//
// URL is literally /msp/export.csv per design §8 — sits outside
// the (protected) group because its auth model is bearer-or-
// session, not session-required.

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) {
    const auth = req.headers.get("authorization") ?? ""
    const secret = process.env.FLEETHUB_AGENT_SECRET ?? ""
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
  }

  const sp = req.nextUrl.searchParams
  const scopeParam = sp.get("scope")
  const scope =
    scopeParam && scopeParam.trim()
      ? scopeParam.split(",").map((s) => s.trim()).filter(Boolean)
      : "all"
  const signalRaw = sp.get("signal") ?? ""
  const severityRaw = sp.get("severity") ?? ""
  const signal = (SIGNAL_FILTERS as readonly string[]).includes(signalRaw)
    ? (signalRaw as SignalFilter)
    : "all"
  const severity = (SEVERITY_FILTERS as readonly string[]).includes(severityRaw)
    ? (severityRaw as SeverityFilter)
    : "warn+"

  const result = await listMspRollup({ scope, signal, severity })
  const csv = buildCsv(result.generatedAt, result.clients, result.ticketHubAvailable)
  const dateStamp = result.generatedAt.toISOString().slice(0, 10)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fleethub-msp-rollup-${dateStamp}.csv"`,
      "cache-control": "no-store",
    },
  })
}

// ─── CSV helpers ──────────────────────────────────────────────────────────

const HEADERS = [
  "generatedAt",
  "client",
  "riskScore",
  "pending",
  "deviceTotal",
  "deviceOnline",
  "deviceOfflineOver24h",
  "alertsOpen",
  "alertsCritical",
  "alertsWarn",
  "alertsInfo",
  "oldestOpenAlertAt",
  "hostsBehindPatch",
  "oldestUnpatchedCvss",
  "kevCveUnpatched",
  "stuckDeploys",
  "failedScripts24h",
  "scheduleStalenessMs",
  "scheduleCount",
  "auditChainStatus",
  "openTickets",
] as const

function buildCsv(
  generatedAt: Date,
  clients: MspRollupClient[],
  ticketHubAvailable: boolean,
): string {
  const ts = generatedAt.toISOString()
  const lines: string[] = [HEADERS.join(",")]
  for (const c of clients) {
    lines.push([
      ts,
      esc(c.name),
      c.riskScore,
      c.pending ? "true" : "false",
      c.deviceTotal,
      c.deviceOnline,
      c.deviceOfflineOver24h,
      c.alertsOpen,
      c.alertsCritical,
      c.alertsWarn,
      c.alertsInfo,
      c.oldestOpenAlertAt ? c.oldestOpenAlertAt.toISOString() : "",
      c.hostsBehindPatch,
      c.oldestUnpatchedCvss != null ? c.oldestUnpatchedCvss.toFixed(1) : "",
      c.kevCveUnpatched,
      c.stuckDeploys,
      c.failedScripts24h,
      c.scheduleStalenessMs != null ? c.scheduleStalenessMs : "",
      c.scheduleCount,
      c.auditChainStatus,
      ticketHubAvailable && c.openTickets != null ? c.openTickets : "",
    ].join(","))
  }
  // RFC 4180 line ending.
  return lines.join("\r\n") + "\r\n"
}

function esc(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
