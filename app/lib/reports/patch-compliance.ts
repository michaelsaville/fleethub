import "server-only"
import { prisma } from "@/lib/prisma"

// PHASE-5-DESIGN §3.1: Patch Compliance — the HIPAA / PCI / SOC 2 workhorse.
//
// Pure data assembly. The PDF template (lib/pdf/PatchComplianceReport.tsx)
// consumes whatever this returns; keeping render and data separate means
// the same shape feeds CSV / JSON / evidence-zip output once those land.
//
// SLA bands per the design doc:
//   critical (CVSS ≥ 9.0)  →  7-day target
//   high     (CVSS ≥ 7.0)  → 30-day target
//   medium   (CVSS ≥ 4.0)  → 90-day target
//   (low + non-CVE rows fall outside SLA tracking)

export interface PatchComplianceData {
  tenantName: string
  asOf: Date
  audience: "tech" | "client" | "auditor"

  headline: {
    totalHosts: number
    compliantHosts: number   // every approved patch state="installed"
    nonCompliantHosts: number
    overdueCritical: number  // ≥9.0 CVSS, missing > 7 days
    overdueHigh: number      // ≥7.0 CVSS, missing > 30 days
    overdueMedium: number    // ≥4.0 CVSS, missing > 90 days
    detectionDisagreements: number
  }

  slaAging: Array<{
    band: "critical" | "high" | "medium"
    targetDays: number
    withinSla: number
    overdue: number
    meanDaysOpen: number     // for OVERDUE rows; 0 if none
  }>

  /** Per-host KB matrix — wide, capped to first MAX_HOSTS hosts. */
  hostMatrix: Array<{
    hostname: string
    clientName: string
    os: string | null
    /** Map of patchSourceId → install state for this host. */
    patches: Record<string, {
      state: string
      installedAt: string | null
      failureReason: string | null
    }>
  }>

  /** Patches referenced in the matrix above. Used to render column headers. */
  patchColumns: Array<{
    sourceId: string
    classification: string
    cvssMax: number | null
    isKev: boolean
  }>

  /** Hosts with operator-supplied opt-outs. v1: pulls from Fl_Patch.notes
   *  when a declined-patch row exists. Phase 5.5 will add a dedicated
   *  Fl_PatchException table. */
  exceptions: Array<{
    hostname: string
    clientName: string
    patchSourceId: string
    reason: string
    declinedBy: string | null
    declinedAt: string | null
  }>

  /** CVEs that flipped to KEV during the report window. Empty asOf →
   *  last 90 days. Per design §3.1 "recent KEV exposure". */
  recentKev: Array<{
    cveId: string
    addedAt: Date
    vendor: string | null
    product: string | null
    cvssBase: number | null
    daysExposed: number  // since kevAddedAt to asOf
  }>
}

// Cap rendered rows to keep the PDF under @react-pdf/renderer's
// reasonable budget. Per design §12 open question — landscape pagination.
const MAX_HOSTS_IN_MATRIX = 50
const MAX_PATCH_COLUMNS = 30
const KEV_LOOKBACK_DAYS = 90

export async function buildPatchComplianceReport(input: {
  tenantName: string
  asOf?: Date
  audience?: "tech" | "client" | "auditor"
}): Promise<PatchComplianceData> {
  const audience = input.audience ?? "client"
  const asOf = input.asOf ?? new Date()

  // 1. All devices for this tenant (denominator + matrix rows).
  const devices = await prisma.fl_Device.findMany({
    where: { clientName: input.tenantName, isActive: true },
    select: { id: true, hostname: true, clientName: true, os: true },
  })

  // 2. All install rows for those devices, joined to patch + cve metadata.
  const deviceIds = devices.map((d) => d.id)
  const installs = await prisma.fl_PatchInstall.findMany({
    where: { deviceId: { in: deviceIds } },
    include: {
      patch: { select: { id: true, sourceId: true, classification: true, cvssMax: true, isKev: true, cveJson: true, approvalState: true, notes: true } },
    },
  })

  // 3. Headline numbers.
  const compliantHostSet = new Set<string>()
  const nonCompliantHostSet = new Set<string>()
  let overdueCritical = 0
  let overdueHigh = 0
  let overdueMedium = 0
  let detectionDisagreements = 0
  for (const i of installs) {
    if (i.state === "detection-disagreement") detectionDisagreements++
    if (i.patch.approvalState !== "approved") continue
    if (i.state === "installed") {
      compliantHostSet.add(i.deviceId)
    } else if (i.state === "missing" || i.state === "failed" || i.state === "preflight-failed") {
      nonCompliantHostSet.add(i.deviceId)
      const overdueDays = daysBetween(i.lastDetectedAt, asOf)
      const cvss = i.patch.cvssMax ?? 0
      if (cvss >= 9 && overdueDays > 7) overdueCritical++
      else if (cvss >= 7 && overdueDays > 30) overdueHigh++
      else if (cvss >= 4 && overdueDays > 90) overdueMedium++
    }
  }
  // A host is compliant only if EVERY approved patch is installed and it has
  // no disagreements. Strict definition matches the auditor's expectation.
  const hostFailureSet = new Set<string>()
  for (const i of installs) {
    if (i.patch.approvalState !== "approved") continue
    if (i.state !== "installed") hostFailureSet.add(i.deviceId)
  }
  const fullyCompliant = devices.filter((d) => !hostFailureSet.has(d.id)).length

  // 4. SLA aging table.
  const slaBands = [
    { band: "critical" as const, minCvss: 9, targetDays: 7 },
    { band: "high" as const, minCvss: 7, targetDays: 30 },
    { band: "medium" as const, minCvss: 4, targetDays: 90 },
  ]
  const slaAging = slaBands.map(({ band, minCvss, targetDays }) => {
    let within = 0, overdue = 0, totalOverdueDays = 0
    for (const i of installs) {
      if (i.patch.approvalState !== "approved") continue
      if (i.state === "installed") continue
      const cvss = i.patch.cvssMax ?? 0
      // Bucket exclusively at the lowest matching band so each row is
      // counted once. Critical band keeps the 9+; high is 7-8.99; medium
      // is 4-6.99.
      const matchedBand =
        cvss >= 9 ? "critical" : cvss >= 7 ? "high" : cvss >= 4 ? "medium" : null
      if (matchedBand !== band) continue
      const daysOpen = daysBetween(i.lastDetectedAt, asOf)
      if (daysOpen <= targetDays) within++
      else { overdue++; totalOverdueDays += daysOpen }
    }
    return {
      band,
      targetDays,
      withinSla: within,
      overdue,
      meanDaysOpen: overdue > 0 ? Math.round(totalOverdueDays / overdue) : 0,
    }
  })

  // 5. Per-host KB matrix.
  const patchUsage = new Map<string, { sourceId: string; classification: string; cvssMax: number | null; isKev: boolean; hits: number }>()
  for (const i of installs) {
    if (i.patch.approvalState !== "approved") continue
    if (i.state === "installed" && audience === "client") continue // client view only shows still-missing
    const key = i.patch.sourceId
    const cur = patchUsage.get(key)
    if (cur) cur.hits++
    else patchUsage.set(key, {
      sourceId: i.patch.sourceId,
      classification: i.patch.classification,
      cvssMax: i.patch.cvssMax,
      isKev: i.patch.isKev,
      hits: 1,
    })
  }
  const patchColumns = Array.from(patchUsage.values())
    .sort((a, b) => Number(b.isKev) - Number(a.isKev) || (b.cvssMax ?? 0) - (a.cvssMax ?? 0) || b.hits - a.hits)
    .slice(0, MAX_PATCH_COLUMNS)
  const patchColumnSet = new Set(patchColumns.map((p) => p.sourceId))

  const installsByDevice = new Map<string, typeof installs>()
  for (const i of installs) {
    if (!patchColumnSet.has(i.patch.sourceId)) continue
    const arr = installsByDevice.get(i.deviceId) ?? []
    arr.push(i)
    installsByDevice.set(i.deviceId, arr)
  }
  const hostMatrix = devices
    .slice(0, MAX_HOSTS_IN_MATRIX)
    .map((d) => {
      const rows = installsByDevice.get(d.id) ?? []
      const patches: Record<string, { state: string; installedAt: string | null; failureReason: string | null }> = {}
      for (const i of rows) {
        patches[i.patch.sourceId] = {
          state: i.state,
          installedAt: i.installedAt ? i.installedAt.toISOString().slice(0, 10) : null,
          failureReason: i.failureReason,
        }
      }
      return {
        hostname: d.hostname,
        clientName: d.clientName,
        os: d.os,
        patches,
      }
    })

  // 6. Exceptions (declined patches with notes). v1 pulls from Fl_Patch.notes.
  const exceptions: PatchComplianceData["exceptions"] = []
  const declinedPatches = await prisma.fl_Patch.findMany({
    where: { approvalState: "declined" },
    select: { id: true, sourceId: true, notes: true, approvedBy: true, approvedAt: true },
  })
  if (declinedPatches.length > 0) {
    const declinedIds = declinedPatches.map((p) => p.id)
    const declinedInstalls = await prisma.fl_PatchInstall.findMany({
      where: { deviceId: { in: deviceIds }, patchId: { in: declinedIds } },
      select: { deviceId: true, patchId: true },
    })
    const deviceById = Object.fromEntries(devices.map((d) => [d.id, d]))
    const patchById = Object.fromEntries(declinedPatches.map((p) => [p.id, p]))
    for (const di of declinedInstalls) {
      const d = deviceById[di.deviceId]
      const p = patchById[di.patchId]
      if (!d || !p) continue
      exceptions.push({
        hostname: d.hostname,
        clientName: d.clientName,
        patchSourceId: p.sourceId,
        reason: p.notes ?? "(no justification provided)",
        declinedBy: p.approvedBy,
        declinedAt: p.approvedAt ? p.approvedAt.toISOString().slice(0, 10) : null,
      })
    }
  }

  // 7. Recent KEV exposure (CVEs that flipped to KEV in the lookback window).
  const sinceWhen = new Date(asOf.getTime() - KEV_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const recentKevAdvisories = await prisma.fl_PatchAdvisory.findMany({
    where: { isKev: true, kevAddedAt: { gte: sinceWhen } },
    orderBy: { kevAddedAt: "desc" },
    take: 30,
  })
  const recentKev = recentKevAdvisories
    .filter((a) => a.kevAddedAt)
    .map((a) => ({
      cveId: a.cveId,
      addedAt: a.kevAddedAt!,
      vendor: a.vendor,
      product: a.product,
      cvssBase: a.cvssBase,
      daysExposed: daysBetween(a.kevAddedAt!, asOf),
    }))

  return {
    tenantName: input.tenantName,
    asOf,
    audience,
    headline: {
      totalHosts: devices.length,
      compliantHosts: fullyCompliant,
      nonCompliantHosts: devices.length - fullyCompliant,
      overdueCritical,
      overdueHigh,
      overdueMedium,
      detectionDisagreements,
    },
    slaAging,
    hostMatrix,
    patchColumns,
    exceptions,
    recentKev,
  }
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
}
