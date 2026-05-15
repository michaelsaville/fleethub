import "server-only"
import { CronExpressionParser } from "cron-parser"
import { prisma } from "@/lib/prisma"
import { listAlerts } from "@/lib/alerts"
import { listDevices, mockMode } from "@/lib/devices"
import { verifyAuditChain, type AuditChainBreak } from "@/lib/audit-chain"

// Phase 6 step 1 — cross-tenant MSP rollup. Pure data layer; consumed
// by /msp triage view (step 2) and the /msp/export.csv endpoint
// (step 9). One function call → everything the dashboard needs to
// render, ready-shaped, sorted by composite risk score.
//
// Design: docs/PHASE-6-DESIGN.md §3 (columns), §4 (risk score), §6
// (permission), §9 (perf).

// ─── Public helpers ──────────────────────────────────────────────────────

/**
 * Stable URL-safe slug for a client name, used as the row anchor on
 * /msp (`<tr id="client-<slug>">`) and as the target of Cmd-K
 * `triage <client>`. Lossy on punctuation; collisions are
 * vanishingly rare at MSP scale and resolve to first-match-wins.
 */
export function clientSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

// ─── Tunables ────────────────────────────────────────────────────────────

const OFFLINE_WINDOW_MS = 24 * 60 * 60 * 1000
const STUCK_DEPLOY_MS = 2 * 60 * 60 * 1000
const FAILED_SCRIPT_WINDOW_MS = 24 * 60 * 60 * 1000
const SCHEDULE_STALE_MS = 24 * 60 * 60 * 1000

// §4 weighted formula — fixed in v1, tunable per-tenant later.
const RISK_WEIGHTS = {
  alertCritical: 10,
  alertWarn: 3,
  offlineHost24h: 5,
  kevCveUnpatched: 4,
  hostBehindPatch: 2,
  stuckDeploy: 3,
  failedScript24h: 4,
  auditChainBreak: 15,
  scheduleStale: 6,
} as const

// ─── Types ───────────────────────────────────────────────────────────────

export interface MspRollupClient {
  name: string
  // Devices
  deviceTotal: number
  deviceOnline: number
  deviceOfflineOver24h: number
  // Alerts. alertsOpen is severity-filtered (default warn+ drops info);
  // alertsCritical / alertsWarn / alertsInfo are the raw tier counts so
  // callers can re-derive if needed.
  alertsOpen: number
  alertsCritical: number
  alertsWarn: number
  alertsInfo: number
  oldestOpenAlertAt: Date | null
  // Patches
  hostsBehindPatch: number
  oldestUnpatchedCvss: number | null
  kevCveUnpatched: number
  // Deploys
  stuckDeploys: number
  // Scripts
  failedScripts24h: number
  // Schedules
  scheduleStalenessMs: number | null
  scheduleCount: number
  // Audit chain — per-client status. "broken-here" only when the
  // global break is owned by this client (chain is fleet-wide).
  auditChainStatus: "ok" | "broken-here"
  // TicketHub overlay — open ticket count from the cross-schema query
  // (anything not in RESOLVED/CLOSED/CANCELLED). null when TH is
  // unavailable; 0 when TH is present but has no open tickets for
  // this client. See MspRollupResult.ticketHubAvailable for the
  // "should I render this column at all?" flag.
  openTickets: number | null
  // Composite (§4)
  riskScore: number
  // Provenance — true when this client has no devices yet but has an
  // Fl_Tenant row (pre-created via /clients/new).
  pending: boolean
}

export interface AttentionCard {
  /** Stable identifier for the card kind — useful for keys + analytics. */
  kind:
    | "audit-chain"
    | "alert-critical"
    | "kev-host"
    | "offline-hosts"
    | "stuck-deploy"
    | "schedule-stale"
  title: string
  value: string
  context: string
  href: string
  tone: "bad" | "warn" | "kev"
}

export interface MspRollupResult {
  generatedAt: Date
  /** Number of clients the caller is allowed to see (post-scope-filter). */
  inScopeClientCount: number
  clients: MspRollupClient[]
  /** "Needs your attention" rail — 0-6 cards. Each card calls out a single,
   *  specific, deep-linkable problem. Empty rail = calm fleet. (§3.1) */
  attentionRail: AttentionCard[]
  /** True when the cross-schema TicketHub query succeeded. False on any
   *  error (missing schema, permission denied, etc.). When false the
   *  table should hide the Tickets column entirely per design §3.2. */
  ticketHubAvailable: boolean
  /** Public-facing TicketHub base URL used by drill-down links. Reads
   *  TICKETHUB_PUBLIC_URL with a sensible default. */
  ticketHubPublicUrl: string
  /** Fleet-wide audit-chain status. Single chain; same answer applies to all
   *  rows. firstBadRow identifies the offending row when intact=false. */
  auditChain: {
    intact: boolean
    firstBadRow: AuditChainBreak | null
    /** Hash of the verified tip (or up to the break). */
    hashLast: string | null
    /** Total rows considered. */
    totalRows: number
  }
}

export type SignalFilter =
  | "all"
  | "alerts"
  | "offline"
  | "patches"
  | "deploys"
  | "scripts"
  | "schedules"
  | "audit"

export type SeverityFilter = "all" | "critical-only" | "warn+" | "info+"

export const SIGNAL_FILTERS: readonly SignalFilter[] = [
  "all", "alerts", "offline", "patches", "deploys", "scripts", "schedules", "audit",
] as const
export const SEVERITY_FILTERS: readonly SeverityFilter[] = [
  "all", "critical-only", "warn+", "info+",
] as const

export interface MspRollupOpts {
  /** When set, only return rows whose name is in this allow-list. v1
   *  hook for fleet_staff_client_scope (HIPAA-READY §3); when undefined
   *  or "all", returns every client. */
  scope?: string[] | "all"
  /** Collapse the table to clients with a non-zero value in the chosen
   *  column. Default "all" = no row filter. */
  signal?: SignalFilter
  /** Determines which alert tiers count toward alertsOpen + the signal=
   *  alerts filter. Default "warn+" drops chatty info per §3.3. */
  severity?: SeverityFilter
}

// ─── Risk score (split for unit-testability) ─────────────────────────────

export function computeRiskScore(
  c: Omit<MspRollupClient, "riskScore" | "name" | "pending" | "auditChainStatus">,
  auditBrokenHere: boolean,
  scheduleStale: boolean,
): number {
  return (
    RISK_WEIGHTS.alertCritical * c.alertsCritical +
    RISK_WEIGHTS.alertWarn * c.alertsWarn +
    RISK_WEIGHTS.offlineHost24h * c.deviceOfflineOver24h +
    RISK_WEIGHTS.kevCveUnpatched * c.kevCveUnpatched +
    RISK_WEIGHTS.hostBehindPatch * c.hostsBehindPatch +
    RISK_WEIGHTS.stuckDeploy * c.stuckDeploys +
    RISK_WEIGHTS.failedScript24h * c.failedScripts24h +
    (auditBrokenHere ? RISK_WEIGHTS.auditChainBreak : 0) +
    (scheduleStale ? RISK_WEIGHTS.scheduleStale : 0)
  )
}

// ─── Main entry ──────────────────────────────────────────────────────────

export async function listMspRollup(opts: MspRollupOpts = {}): Promise<MspRollupResult> {
  const generatedAt = new Date()
  const now = generatedAt.getTime()
  const offlineCutoff = new Date(now - OFFLINE_WINDOW_MS)
  const stuckCutoff = new Date(now - STUCK_DEPLOY_MS)
  const failedScriptCutoff = new Date(now - FAILED_SCRIPT_WINDOW_MS)
  const isMock = await mockMode()

  // Devices + alerts go through their existing list helpers so mock mode
  // and any future authz layer are honored uniformly across the app.
  const [{ rows: devices }, { rows: alerts }] = await Promise.all([
    listDevices(),
    listAlerts({ state: "all" }),
  ])

  // Pre-build a device->client + device->hostname map so per-deviceId
  // aggregations (patches, deploys, scripts) can be grouped by client
  // in one pass, and the rail cards can name the offending host.
  const deviceClient = new Map<string, string>()
  const deviceHostname = new Map<string, string>()
  for (const d of devices) {
    deviceClient.set(d.id, d.clientName)
    deviceHostname.set(d.id, d.hostname)
  }
  const deviceIds = [...deviceClient.keys()]

  // ─── Bulk queries — five in parallel, scoped to live device set ─────
  const [
    pendingPatchRows,
    stuckDeployRows,
    failedScriptRows,
    scheduleRows,
    tenantRows,
  ] = isMock
    ? [[], [], [], [], []]
    : await prisma.$transaction([
        prisma.fl_PatchInstall.findMany({
          where: { state: "pending", deviceId: { in: deviceIds } },
          select: {
            deviceId: true,
            patch: { select: { cvssMax: true, isKev: true } },
          },
        }),
        prisma.fl_DeploymentTarget.findMany({
          where: {
            status: "installing",
            updatedAt: { lt: stuckCutoff },
            deviceId: { in: deviceIds },
          },
          select: {
            deviceId: true,
            deploymentId: true,
            updatedAt: true,
          },
        }),
        prisma.fl_ScriptRun.findMany({
          where: {
            state: "failed",
            createdAt: { gte: failedScriptCutoff },
            deviceId: { in: deviceIds },
          },
          select: { deviceId: true },
        }),
        prisma.fl_ReportSchedule.findMany({
          where: { isActive: true },
          select: {
            id: true,
            tenantName: true,
            kind: true,
            cron: true,
            timezone: true,
            lastFiredAt: true,
            createdAt: true,
          },
        }),
        prisma.fl_Tenant.findMany({ select: { name: true } }),
      ])

  // Audit chain is fleet-wide; one walk, applied per-client below.
  const auditChain = isMock
    ? { intact: true, firstBadRow: null, hashLast: null, totalRows: 0 }
    : await verifyAuditChain().then((r) => ({
        intact: r.intact,
        firstBadRow: r.brokenAt,
        hashLast: r.hashLast,
        totalRows: r.totalRows,
      }))

  // TicketHub overlay — cross-schema $queryRaw, same pattern as
  // Phase 5.13's pre-create form. Wrapped in try/catch so a missing
  // schema (running FleetHub without TicketHub) silently hides the
  // column instead of breaking the dashboard. §12 notes this should
  // eventually become a typed view (`tickethub.fl_v_open_tickets`)
  // committed-to as a contract by the TH side — Phase 6.1 follow-up.
  const ticketHubPublicUrl = (process.env.TICKETHUB_PUBLIC_URL || "https://tickethub.pcc2k.com").replace(/\/$/, "")
  const ticketCounts = new Map<string, number>()
  let ticketHubAvailable = false
  if (!isMock) {
    try {
      const rows = await prisma.$queryRaw<{ client_name: string; open_count: bigint }[]>`
        SELECT c."name" AS client_name, COUNT(t.id) AS open_count
        FROM tickethub.th_tickets t
        JOIN tickethub.th_clients c ON c.id = t."clientId"
        WHERE t.status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED')
        GROUP BY c."name"
      `
      ticketHubAvailable = true
      for (const r of rows) ticketCounts.set(r.client_name, Number(r.open_count))
    } catch (err) {
      ticketHubAvailable = false
      console.warn("[msp-rollup] TicketHub overlay unavailable:", (err as Error).message)
    }
  }

  // ─── Aggregate per client ────────────────────────────────────────────
  const byClient = new Map<string, MspRollupClient>()
  const blank = (name: string, pending: boolean): MspRollupClient => ({
    name,
    deviceTotal: 0,
    deviceOnline: 0,
    deviceOfflineOver24h: 0,
    alertsOpen: 0,
    alertsCritical: 0,
    alertsWarn: 0,
    alertsInfo: 0,
    oldestOpenAlertAt: null,
    hostsBehindPatch: 0,
    oldestUnpatchedCvss: null,
    kevCveUnpatched: 0,
    stuckDeploys: 0,
    failedScripts24h: 0,
    scheduleStalenessMs: null,
    scheduleCount: 0,
    auditChainStatus: "ok",
    openTickets: null,
    riskScore: 0,
    pending,
  })

  // Seed with tenant-only rows so pre-created clients (no devices yet)
  // still appear. Mirrors listClients() behavior.
  for (const t of tenantRows) byClient.set(t.name, blank(t.name, true))

  // Devices
  for (const d of devices) {
    const r = byClient.get(d.clientName) ?? blank(d.clientName, false)
    r.pending = false
    r.deviceTotal++
    if (d.isOnline) r.deviceOnline++
    if (d.lastSeenAt && d.lastSeenAt < offlineCutoff) r.deviceOfflineOver24h++
    // Re-use the Phase-4-fed inventory snapshot for hosts-behind-patch
    // count — same source the /clients page uses; matches operator
    // expectations.
    if ((d.inventory?.patches.pending ?? 0) > 0) r.hostsBehindPatch++
    byClient.set(d.clientName, r)
  }

  // Alerts — count per tier; alertsOpen is the severity-filtered sum
  // applied in a separate pass below so the raw tier counts stay
  // available for callers that want them.
  for (const a of alerts) {
    if (!a.clientName) continue
    const r = byClient.get(a.clientName)
    if (!r) continue
    if (a.state !== "open") continue
    if (a.severity === "critical") r.alertsCritical++
    else if (a.severity === "warn") r.alertsWarn++
    else r.alertsInfo++
    if (!r.oldestOpenAlertAt || a.createdAt < r.oldestOpenAlertAt) {
      r.oldestOpenAlertAt = a.createdAt
    }
  }
  const severity: SeverityFilter = opts.severity ?? "warn+"
  for (const r of byClient.values()) {
    r.alertsOpen = visibleAlertCount(r, severity)
  }

  // Patches — count unique hosts-behind from Fl_PatchInstall as the
  // authoritative source; keep max-cvss + kev-cve count alongside.
  // hostsBehindPatch from devices.inventory is left as the operator-
  // facing chip; Fl_PatchInstall is the precise count for risk score.
  const kevHostsByClient = new Map<string, Set<string>>()
  for (const p of pendingPatchRows) {
    const client = deviceClient.get(p.deviceId)
    if (!client) continue
    const r = byClient.get(client)
    if (!r) continue
    const cvss = p.patch?.cvssMax ?? null
    if (cvss != null && (r.oldestUnpatchedCvss == null || cvss > r.oldestUnpatchedCvss)) {
      r.oldestUnpatchedCvss = cvss
    }
    if (p.patch?.isKev) {
      let kevHosts = kevHostsByClient.get(client)
      if (!kevHosts) {
        kevHosts = new Set()
        kevHostsByClient.set(client, kevHosts)
      }
      kevHosts.add(p.deviceId)
    }
  }
  for (const [client, hosts] of kevHostsByClient) {
    const r = byClient.get(client)
    if (r) r.kevCveUnpatched = hosts.size
  }

  // Stuck deploys
  for (const t of stuckDeployRows) {
    const client = deviceClient.get(t.deviceId)
    if (!client) continue
    const r = byClient.get(client)
    if (r) r.stuckDeploys++
  }

  // Failed scripts
  for (const s of failedScriptRows) {
    const client = deviceClient.get(s.deviceId)
    if (!client) continue
    const r = byClient.get(client)
    if (r) r.failedScripts24h++
  }

  // Schedules — staleness = age of oldest lastFiredAt across this
  // tenant's active schedules. null when no active schedules.
  for (const s of scheduleRows) {
    const r = byClient.get(s.tenantName)
    if (!r) continue
    r.scheduleCount++
    if (!s.lastFiredAt) continue
    const age = now - s.lastFiredAt.getTime()
    if (r.scheduleStalenessMs == null || age > r.scheduleStalenessMs) {
      r.scheduleStalenessMs = age
    }
  }

  // Audit chain — per-client status flag, set only on the broken row's
  // owning client (chain is fleet-wide; one client carries the marker).
  if (!auditChain.intact && auditChain.firstBadRow?.clientName) {
    const r = byClient.get(auditChain.firstBadRow.clientName)
    if (r) r.auditChainStatus = "broken-here"
  }

  // TicketHub overlay — populate openTickets when TH is available.
  // When TH is available but a client has no row in ticketCounts, the
  // count is 0 (TH knows about no tickets for this client). When TH
  // is unavailable, leave null so the table can hide the column.
  if (ticketHubAvailable) {
    for (const r of byClient.values()) {
      r.openTickets = ticketCounts.get(r.name) ?? 0
    }
  }

  // Risk score — last pass, after all signals are settled.
  for (const r of byClient.values()) {
    const staleSchedule =
      r.scheduleStalenessMs != null && r.scheduleStalenessMs > SCHEDULE_STALE_MS
    r.riskScore = computeRiskScore(r, r.auditChainStatus === "broken-here", staleSchedule)
  }

  // ─── Scope filter (HIPAA-READY §3 hook; v1 no-op when no scope passed)
  const allRows = [...byClient.values()]
  const scoped =
    !opts.scope || opts.scope === "all"
      ? allRows
      : allRows.filter((r) => (opts.scope as string[]).includes(r.name))

  scoped.sort((a, b) =>
    b.riskScore - a.riskScore || a.name.localeCompare(b.name),
  )

  // ─── Signal filter — applies AFTER scope + sort so the rail (built
  //   below) and the inScopeClientCount still reflect the operator's
  //   real scope, while the visible table collapses to only clients
  //   with non-zero values in the chosen column.
  const signal: SignalFilter = opts.signal ?? "all"
  const filtered = signal === "all" ? scoped : scoped.filter((r) => matchesSignal(r, signal))

  const inScopeNames = new Set(scoped.map((r) => r.name))
  const attentionRail = buildAttentionRail({
    now,
    inScopeNames,
    alerts,
    pendingPatchRows,
    stuckDeployRows,
    scheduleRows,
    devices,
    deviceClient,
    deviceHostname,
    auditChain,
  })

  return {
    generatedAt,
    inScopeClientCount: scoped.length,
    clients: filtered,
    attentionRail,
    ticketHubAvailable,
    ticketHubPublicUrl,
    auditChain,
  }
}

// ─── Filter helpers ──────────────────────────────────────────────────────

function visibleAlertCount(c: MspRollupClient, severity: SeverityFilter): number {
  switch (severity) {
    case "critical-only": return c.alertsCritical
    case "warn+":         return c.alertsCritical + c.alertsWarn
    case "info+":
    case "all":           return c.alertsCritical + c.alertsWarn + c.alertsInfo
  }
}

function matchesSignal(c: MspRollupClient, signal: SignalFilter): boolean {
  switch (signal) {
    case "all":       return true
    case "alerts":    return c.alertsOpen > 0
    case "offline":   return c.deviceOfflineOver24h > 0
    case "patches":   return c.hostsBehindPatch > 0
    case "deploys":   return c.stuckDeploys > 0
    case "scripts":   return c.failedScripts24h > 0
    case "schedules": return c.scheduleStalenessMs != null && c.scheduleStalenessMs > 24 * 60 * 60 * 1000
    case "audit":     return c.auditChainStatus === "broken-here"
  }
}

// ─── Attention rail builders ─────────────────────────────────────────────

type AlertRow = Awaited<ReturnType<typeof listAlerts>>["rows"][number]
type DeviceRow = Awaited<ReturnType<typeof listDevices>>["rows"][number]

interface RailInput {
  now: number
  inScopeNames: Set<string>
  alerts: AlertRow[]
  pendingPatchRows: Array<{
    deviceId: string
    patch: { cvssMax: number | null; isKev: boolean } | null
  }>
  stuckDeployRows: Array<{ deviceId: string; deploymentId: string; updatedAt: Date }>
  scheduleRows: Array<{
    id: string
    tenantName: string
    kind: string
    cron: string
    timezone: string
    lastFiredAt: Date | null
    createdAt: Date
  }>
  devices: DeviceRow[]
  deviceClient: Map<string, string>
  deviceHostname: Map<string, string>
  auditChain: MspRollupResult["auditChain"]
}

function buildAttentionRail(i: RailInput): AttentionCard[] {
  const cards: AttentionCard[] = []

  // 1. Audit chain — fleet-wide signal; show only when the bad row's
  //    owning client is in scope (so out-of-scope operators can't
  //    infer "something's wrong over there").
  if (
    !i.auditChain.intact &&
    i.auditChain.firstBadRow &&
    (!i.auditChain.firstBadRow.clientName ||
      i.inScopeNames.has(i.auditChain.firstBadRow.clientName))
  ) {
    const r = i.auditChain.firstBadRow
    cards.push({
      kind: "audit-chain",
      title: "Audit chain integrity broken",
      value: `Row ${r.index + 1}`,
      context: `${r.clientName ?? "unattributed"} · ${r.reason}`,
      href: r.clientName
        ? `/audit?client=${encodeURIComponent(r.clientName)}`
        : `/audit`,
      tone: "bad",
    })
  }

  // 2. Oldest open critical alert in scope.
  const openCritical = i.alerts.filter(
    (a) =>
      a.state === "open" &&
      a.severity === "critical" &&
      a.clientName &&
      i.inScopeNames.has(a.clientName),
  )
  if (openCritical.length > 0) {
    const oldest = openCritical.reduce((a, b) => (a.createdAt < b.createdAt ? a : b))
    cards.push({
      kind: "alert-critical",
      title: "Oldest open critical alert",
      value: formatAge(i.now - oldest.createdAt.getTime()),
      context: `${oldest.clientName} · ${oldest.title}`,
      href: `/alerts/${oldest.id}`,
      tone: "bad",
    })
  }

  // 3. Host with most KEV CVEs unpatched (in scope).
  const kevByHost = new Map<string, number>()
  for (const p of i.pendingPatchRows) {
    if (!p.patch?.isKev) continue
    const client = i.deviceClient.get(p.deviceId)
    if (!client || !i.inScopeNames.has(client)) continue
    kevByHost.set(p.deviceId, (kevByHost.get(p.deviceId) ?? 0) + 1)
  }
  if (kevByHost.size > 0) {
    let topHost = ""
    let topCount = 0
    for (const [hostId, count] of kevByHost) {
      if (count > topCount) {
        topHost = hostId
        topCount = count
      }
    }
    const hostname = i.deviceHostname.get(topHost) ?? topHost
    const client = i.deviceClient.get(topHost) ?? "—"
    cards.push({
      kind: "kev-host",
      title: "Most KEV CVEs unpatched",
      value: `${topCount} KEV`,
      context: `${hostname} · ${client}`,
      href: `/devices/${topHost}?tab=patches`,
      tone: "kev",
    })
  }

  // 4. Client with the most hosts offline >24h.
  const offlineByClient = new Map<string, number>()
  const offlineCutoff = new Date(i.now - 24 * 60 * 60 * 1000)
  for (const d of i.devices) {
    if (!i.inScopeNames.has(d.clientName)) continue
    if (d.lastSeenAt && d.lastSeenAt < offlineCutoff) {
      offlineByClient.set(d.clientName, (offlineByClient.get(d.clientName) ?? 0) + 1)
    }
  }
  if (offlineByClient.size > 0) {
    let topClient = ""
    let topCount = 0
    for (const [client, count] of offlineByClient) {
      if (count > topCount) {
        topClient = client
        topCount = count
      }
    }
    cards.push({
      kind: "offline-hosts",
      title: "Hosts offline >24h",
      value: `${topCount} host${topCount === 1 ? "" : "s"}`,
      context: topClient,
      href: `/clients/${encodeURIComponent(topClient)}?tab=devices&filter=offline-24h`,
      tone: "bad",
    })
  }

  // 5. Oldest stuck deploy (in scope).
  const scopedStuck = i.stuckDeployRows.filter((t) => {
    const client = i.deviceClient.get(t.deviceId)
    return client && i.inScopeNames.has(client)
  })
  if (scopedStuck.length > 0) {
    const oldest = scopedStuck.reduce((a, b) => (a.updatedAt < b.updatedAt ? a : b))
    const client = i.deviceClient.get(oldest.deviceId) ?? "—"
    const hostname = i.deviceHostname.get(oldest.deviceId) ?? oldest.deviceId
    cards.push({
      kind: "stuck-deploy",
      title: "Stuck deploy",
      value: `${formatAge(i.now - oldest.updatedAt.getTime())} stuck`,
      context: `${hostname} · ${client}`,
      href: `/deployments/${oldest.deploymentId}`,
      tone: "warn",
    })
  }

  // 6. Most-overdue active schedule (cron-derived). A schedule that
  //    should have fired ≥1h ago is overdue; pick the one with the
  //    largest "should-have-fired ago" delta.
  let mostOverdue: {
    sched: RailInput["scheduleRows"][number]
    overdueMs: number
  } | null = null
  for (const s of i.scheduleRows) {
    if (!i.inScopeNames.has(s.tenantName)) continue
    let nextExpected: Date
    try {
      const baseTime = s.lastFiredAt ?? s.createdAt
      const it = CronExpressionParser.parse(s.cron, {
        currentDate: baseTime,
        tz: s.timezone || "UTC",
      })
      nextExpected = it.next().toDate()
    } catch {
      continue
    }
    const overdueMs = i.now - nextExpected.getTime()
    if (overdueMs < 60 * 60 * 1000) continue // <1h overdue is normal jitter
    if (!mostOverdue || overdueMs > mostOverdue.overdueMs) {
      mostOverdue = { sched: s, overdueMs }
    }
  }
  if (mostOverdue) {
    cards.push({
      kind: "schedule-stale",
      title: "Most overdue schedule",
      value: `${formatAge(mostOverdue.overdueMs)} late`,
      context: `${mostOverdue.sched.tenantName} · ${mostOverdue.sched.kind}`,
      href: `/reports/scheduled?client=${encodeURIComponent(mostOverdue.sched.tenantName)}`,
      tone: "warn",
    })
  }

  return cards
}

function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}
