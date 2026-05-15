import "server-only"
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
  // Alerts
  alertsOpen: number
  alertsCritical: number
  alertsWarn: number
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
  // Composite (§4)
  riskScore: number
  // Provenance — true when this client has no devices yet but has an
  // Fl_Tenant row (pre-created via /clients/new).
  pending: boolean
}

export interface MspRollupResult {
  generatedAt: Date
  /** Number of clients the caller is allowed to see (post-scope-filter). */
  inScopeClientCount: number
  clients: MspRollupClient[]
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

export interface MspRollupOpts {
  /** When set, only return rows whose name is in this allow-list. v1
   *  hook for fleet_staff_client_scope (HIPAA-READY §3); when undefined
   *  or "all", returns every client. */
  scope?: string[] | "all"
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

  // Pre-build a device->client map so the per-deviceId aggregations
  // (patches, deploys, scripts) can be grouped by client in one pass.
  const deviceClient = new Map<string, string>()
  for (const d of devices) deviceClient.set(d.id, d.clientName)
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
          select: { deviceId: true },
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
          select: { tenantName: true, lastFiredAt: true },
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
    oldestOpenAlertAt: null,
    hostsBehindPatch: 0,
    oldestUnpatchedCvss: null,
    kevCveUnpatched: 0,
    stuckDeploys: 0,
    failedScripts24h: 0,
    scheduleStalenessMs: null,
    scheduleCount: 0,
    auditChainStatus: "ok",
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

  // Alerts
  for (const a of alerts) {
    if (!a.clientName) continue
    const r = byClient.get(a.clientName)
    if (!r) continue
    if (a.state !== "open") continue
    r.alertsOpen++
    if (a.severity === "critical") r.alertsCritical++
    else if (a.severity === "warn") r.alertsWarn++
    if (!r.oldestOpenAlertAt || a.createdAt < r.oldestOpenAlertAt) {
      r.oldestOpenAlertAt = a.createdAt
    }
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

  return {
    generatedAt,
    inScopeClientCount: scoped.length,
    clients: scoped,
    auditChain,
  }
}
