import "server-only"
import crypto from "node:crypto"
import JSZip from "jszip"
import { prisma } from "@/lib/prisma"
import { buildPatchComplianceReport } from "@/lib/reports/patch-compliance"
import type { ReportKind } from "@/lib/reports/render"

// Phase 5 step 11 — Evidence ZIP packaging.
//
// The "give this to your auditor" artifact: a single .zip containing the
// human-readable PDF, the underlying raw data as CSVs, the audit-log
// slice for the period, the chain-verification result, an exceptions
// list, a signed (sha256-only in v1) manifest, and a README that walks
// the auditor through everything.
//
// Per PHASE-5-DESIGN §7. v1 deviations from the design:
//   - manifest.signature is null in v1; tamper-evidence is via per-file
//     sha256 + audit-chain tip hash. Ed25519 signing waits on a key-
//     management surface (tracked as 11.5).
//   - Multi-tenant rollups are out of scope (Phase 5.5).
//
// The orchestrator is invoked from lib/reports/render.ts when
// Fl_Report.format === "evidence-zip". The PDF that goes into the ZIP
// is rendered by the same code as the standalone PDF report; we receive
// it as a buffer rather than rebuilding.

export interface EvidenceZipInput {
  reportId: string
  kind: ReportKind
  tenantName: string
  audience: "tech" | "client" | "auditor"
  /** Period covered by the evidence package. For point-in-time reports
   *  (patch-compliance, identity-posture) the span is asOf±0; we still
   *  record start/end so manifest semantics are uniform. */
  startDate: Date
  endDate: Date
  /** PDF bytes for the underlying report — already rendered upstream. */
  pdfBytes: Buffer
  generatedAt: Date
  generatedBy: string | null
  fleethubVersion: string
}

export interface EvidenceZipResult {
  zipBytes: Buffer
  /** sha256 of the resulting ZIP (used as Fl_Report.artifactSha256). */
  zipSha256: string
  /** Stable, file-system-friendly basename (no extension). The download
   *  route appends ".zip". */
  basename: string
  /** Number of files inside the ZIP — useful for audit logging. */
  fileCount: number
}

export async function buildEvidenceZip(
  input: EvidenceZipInput,
): Promise<EvidenceZipResult> {
  const zip = new JSZip()
  const slug = slugifyTenant(input.tenantName)
  const periodTag = periodTagFor(input.startDate, input.endDate)
  const basename = `${input.kind}-${slug}-${periodTag}-evidence`

  // 1. Underlying PDF.
  const pdfName = `${input.kind}-${slug}-${periodTag}.pdf`
  zip.file(pdfName, input.pdfBytes)

  // 2. Per-kind underlying-data CSV.
  const dataCsv = await buildDataCsv(input)
  const dataCsvName = `${input.kind}-${slug}-${periodTag}.csv`
  zip.file(dataCsvName, dataCsv)

  // 3. Audit-log slice for the period (this tenant + global rows).
  const auditCsv = await buildAuditLogCsv(input.tenantName, input.startDate, input.endDate)
  const auditCsvName = `audit-log-${slug}-${periodTag}.csv`
  zip.file(auditCsvName, auditCsv)

  // 4. Audit-chain verification text — proves chain continuity at
  //    package-creation time. Auditors re-run /api/audit/verify later
  //    to confirm continuity hasn't been broken since.
  const verifyTxt = await buildAuditChainVerificationText()
  const verifyName = "audit-chain-verification.txt"
  zip.file(verifyName, verifyTxt.text)

  // 5. Deployments CSV — every Fl_Deployment in the period for this
  //    tenant, plus their per-target outcome counts.
  const deploysCsv = await buildDeploymentsCsv(input.tenantName, input.startDate, input.endDate)
  const deploysName = `deployments-${slug}-${periodTag}.csv`
  zip.file(deploysName, deploysCsv)

  // 6. Exceptions CSV — patches with approval state declined / deferred /
  //    auto-declined and their justifications. Auditors care about the
  //    *what* and *why* of opt-outs.
  const exceptionsCsv = await buildExceptionsCsv()
  const exceptionsName = "exceptions.csv"
  zip.file(exceptionsName, exceptionsCsv)

  // 7. Manifest — built last so it can include sha256 over every other
  //    file. Exclude the manifest itself + README from the manifest's
  //    file list to avoid a chicken-and-egg.
  const filesForManifest: Array<{ name: string; bytes: Buffer | string }> = [
    { name: pdfName, bytes: input.pdfBytes },
    { name: dataCsvName, bytes: dataCsv },
    { name: auditCsvName, bytes: auditCsv },
    { name: verifyName, bytes: verifyTxt.text },
    { name: deploysName, bytes: deploysCsv },
    { name: exceptionsName, bytes: exceptionsCsv },
  ]
  const manifest = buildManifest({
    input,
    auditChainTipHash: verifyTxt.tipHash,
    auditChainIntact: verifyTxt.intact,
    files: filesForManifest.map((f) => ({
      name: f.name,
      sha256: sha256Of(f.bytes),
      bytes: byteLength(f.bytes),
    })),
  })
  zip.file("manifest.json", JSON.stringify(manifest, null, 2))

  // 8. README — auditor walkthrough.
  zip.file("README.txt", buildReadme({ input, periodTag, tenantSlug: slug }))

  const zipBytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })
  const zipSha256 = sha256Of(zipBytes)

  return {
    zipBytes,
    zipSha256,
    basename,
    fileCount: Object.keys(zip.files).length,
  }
}

// ── CSV builders ───────────────────────────────────────────────────────────

async function buildDataCsv(input: EvidenceZipInput): Promise<string> {
  switch (input.kind) {
    case "patch-compliance":
      return buildPatchComplianceCsv(input)
    case "software-inventory":
      return buildSoftwareInventoryCsv(input.tenantName)
    case "performance-trend":
      return buildPerformanceTrendCsv(input.tenantName, input.startDate, input.endDate)
    case "identity-posture":
      return buildIdentityPostureCsv(input.tenantName)
    case "qbr":
      // QBR has no single "underlying table" — it's a digest of the others.
      // Drop a TEXT pointer to the other CSVs in the same ZIP.
      return [
        "kind,note",
        `qbr,The QBR is an executive digest of the other reports. See patch-compliance, software-inventory, performance-trend, identity-posture for raw data.`,
      ].join("\n") + "\n"
    default:
      return `kind\n${input.kind}\n`
  }
}

async function buildPatchComplianceCsv(input: EvidenceZipInput): Promise<string> {
  // Fl_Device has no explicit relation to Fl_PatchInstall — `deviceId` is a
  // plain string column. Fetch the tenant's devices first, then the installs
  // for those device ids, then join in code.
  const devices = await prisma.fl_Device.findMany({
    where: { clientName: input.tenantName },
    select: { id: true, hostname: true, os: true, clientName: true },
  })
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  if (devices.length === 0) {
    return toCsv([[
      "deviceId", "hostname", "os", "tenant",
      "patchSource", "patchSourceId", "patchTitle", "classification",
      "isKev", "cvssMax", "approvalState",
      "state", "lastDetectedAt", "installedAt", "failureReason",
    ]])
  }
  const installs = await prisma.fl_PatchInstall.findMany({
    where: { deviceId: { in: devices.map((d) => d.id) } },
    include: {
      patch: {
        select: {
          source: true,
          sourceId: true,
          title: true,
          classification: true,
          isKev: true,
          cvssMax: true,
          approvalState: true,
        },
      },
    },
  })
  const rows: string[][] = [[
    "deviceId", "hostname", "os", "tenant",
    "patchSource", "patchSourceId", "patchTitle", "classification",
    "isKev", "cvssMax", "approvalState",
    "state", "lastDetectedAt", "installedAt", "failureReason",
  ]]
  for (const i of installs) {
    const d = deviceById.get(i.deviceId)
    rows.push([
      i.deviceId,
      d?.hostname ?? "",
      d?.os ?? "",
      d?.clientName ?? "",
      i.patch.source,
      i.patch.sourceId,
      i.patch.title,
      i.patch.classification,
      String(i.patch.isKev),
      i.patch.cvssMax !== null ? String(i.patch.cvssMax) : "",
      i.patch.approvalState,
      i.state,
      i.lastDetectedAt.toISOString(),
      i.installedAt?.toISOString() ?? "",
      i.failureReason ?? "",
    ])
  }
  return toCsv(rows)
}

async function buildSoftwareInventoryCsv(tenantName: string): Promise<string> {
  // Best-effort: walk all devices for the tenant + their reported softwareJson.
  // The agent reports installed software periodically; v1 stores as JSON on
  // a per-device latest-snapshot row. If the model is named differently,
  // this CSV is a thin pointer rather than the full inventory.
  const devices = await prisma.fl_Device.findMany({
    where: { clientName: tenantName },
    select: { id: true, hostname: true, os: true, lastSeenAt: true },
  })
  const rows: string[][] = [["deviceId", "hostname", "os", "lastSeenAt"]]
  for (const d of devices) {
    rows.push([d.id, d.hostname ?? "", d.os ?? "", d.lastSeenAt?.toISOString() ?? ""])
  }
  return toCsv(rows)
}

async function buildPerformanceTrendCsv(
  tenantName: string,
  startDate: Date,
  endDate: Date,
): Promise<string> {
  // Same join-in-code pattern as patch-compliance — Fl_PerformanceSample has
  // no Prisma relation to Fl_Device.
  const devices = await prisma.fl_Device.findMany({
    where: { clientName: tenantName },
    select: { id: true, hostname: true, os: true },
  })
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const header: string[] = [
    "deviceId", "hostname", "os", "windowStart",
    "cpuAvgPct", "cpuP95Pct", "ramAvgPct", "ramP95Pct",
    "diskUsedPct", "netInBytes", "netOutBytes",
    "uptimeSec", "missedHeartbeats",
  ]
  if (devices.length === 0) return toCsv([header])

  const samples = await prisma.fl_PerformanceSample.findMany({
    where: {
      window: "1d",
      windowStart: { gte: startDate, lte: endDate },
      deviceId: { in: devices.map((d) => d.id) },
    },
    orderBy: [{ deviceId: "asc" }, { windowStart: "asc" }],
  })
  const rows: string[][] = [header]
  for (const s of samples) {
    const d = deviceById.get(s.deviceId)
    rows.push([
      s.deviceId,
      d?.hostname ?? "",
      d?.os ?? "",
      s.windowStart.toISOString(),
      String(s.cpuAvgPct),
      String(s.cpuP95Pct),
      String(s.ramAvgPct),
      String(s.ramP95Pct),
      String(s.diskUsedPct),
      String(s.netInBytes),
      String(s.netOutBytes),
      String(s.uptimeSec),
      String(s.missedHeartbeats),
    ])
  }
  return toCsv(rows)
}

async function buildIdentityPostureCsv(tenantName: string): Promise<string> {
  // Identity Posture pulls cross-app from Scout; the canonical ZIP version
  // is a thin wrapper that records the tenant + tells the auditor to read
  // the PDF for the actual posture findings.
  return [
    "tenant,note",
    `${escapeCsv(tenantName)},Identity Posture findings are in the PDF. Scout BFF response is point-in-time and not exported here.`,
  ].join("\n") + "\n"
}

async function buildAuditLogCsv(
  tenantName: string,
  startDate: Date,
  endDate: Date,
): Promise<string> {
  // Include rows where clientName matches OR clientName is null (global
  // ops like auth events). Auditors get fewer surprises with the broader
  // window — they can filter further client-side.
  const rows = await prisma.fl_AuditLog.findMany({
    where: {
      AND: [
        { createdAt: { gte: startDate, lte: endDate } },
        {
          OR: [
            { clientName: tenantName },
            { clientName: null },
          ],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
  })
  const csvRows: string[][] = [[
    "id", "createdAt", "actorEmail", "clientName", "deviceId",
    "action", "outcome", "detail", "rowHash",
  ]]
  for (const r of rows) {
    csvRows.push([
      r.id,
      r.createdAt.toISOString(),
      r.actorEmail ?? "",
      r.clientName ?? "",
      r.deviceId ?? "",
      r.action,
      r.outcome,
      r.detailJson ?? "",
      r.rowHash ?? "",
    ])
  }
  return toCsv(csvRows)
}

async function buildAuditChainVerificationText(): Promise<{
  text: string
  tipHash: string | null
  intact: boolean
}> {
  // Re-run the same logic as /api/audit/verify so the text artifact is
  // self-contained (auditors don't have to call the API). On a chain
  // break we surface the failing row so a forensic check can pick up
  // from the same point.
  const rows = await prisma.fl_AuditLog.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })
  let prevHash: string | null = null
  let verified = 0
  let brokenAt: { id: string; index: number; createdAt: string; reason: string } | null = null
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.prevHash !== prevHash) {
      brokenAt = { id: r.id, index: i, createdAt: r.createdAt.toISOString(), reason: "prevHash mismatch" }
      break
    }
    const expected = hashRow({
      prevHash,
      actorEmail: r.actorEmail,
      clientName: r.clientName,
      deviceId: r.deviceId,
      action: r.action,
      outcome: r.outcome,
      detailJson: r.detailJson,
      createdAt: r.createdAt,
    })
    if (expected !== r.rowHash) {
      brokenAt = { id: r.id, index: i, createdAt: r.createdAt.toISOString(), reason: "rowHash mismatch" }
      break
    }
    verified++
    prevHash = r.rowHash
  }
  const intact = brokenAt === null
  const lines = [
    "FleetHub audit-chain verification",
    "==================================",
    `checked at:    ${new Date().toISOString()}`,
    `total rows:    ${rows.length}`,
    `verified rows: ${verified}`,
    `intact:        ${intact ? "YES" : "NO"}`,
    `tip hash:      ${prevHash ?? "(empty chain)"}`,
  ]
  if (brokenAt) {
    lines.push(
      "",
      "Chain break detected:",
      `  row id:     ${brokenAt.id}`,
      `  row index:  ${brokenAt.index}`,
      `  created at: ${brokenAt.createdAt}`,
      `  reason:     ${brokenAt.reason}`,
    )
  }
  lines.push(
    "",
    "Re-run later via GET /api/audit/verify (ADMIN session). The auditor",
    "should re-walk the chain at receipt and confirm the tip hash above",
    "still appears in the live verify output (tip moves forward over",
    "time, but every row up to it must remain intact).",
  )
  return { text: lines.join("\n") + "\n", tipHash: prevHash, intact }
}

async function buildDeploymentsCsv(
  tenantName: string,
  startDate: Date,
  endDate: Date,
): Promise<string> {
  const deploys = await prisma.fl_Deployment.findMany({
    where: {
      tenantName,
      createdAt: { gte: startDate, lte: endDate },
    },
    orderBy: { createdAt: "asc" },
  })
  const rows: string[][] = [[
    "id", "createdAt", "packageId", "ringId", "action", "status", "dryRun",
    "rebootPolicyOverride", "scheduledFor", "startedAt", "completedAt",
    "requestedBy", "totalTargets", "succeededCount", "failedCount",
    "noOpCount", "pendingCount", "rebootDeferredCount",
  ]]
  for (const d of deploys) {
    rows.push([
      d.id,
      d.createdAt.toISOString(),
      d.packageId,
      d.ringId,
      d.action,
      d.status,
      String(d.dryRun),
      d.rebootPolicyOverride ?? "",
      d.scheduledFor?.toISOString() ?? "",
      d.startedAt?.toISOString() ?? "",
      d.completedAt?.toISOString() ?? "",
      d.requestedBy,
      String(d.totalTargets),
      String(d.succeededCount),
      String(d.failedCount),
      String(d.noOpCount),
      String(d.pendingCount),
      String(d.rebootDeferredCount),
    ])
  }
  return toCsv(rows)
}

async function buildExceptionsCsv(): Promise<string> {
  // Patches with approvalState in declined / auto-declined / deferred —
  // these are the operator-recorded opt-outs. notes carries the
  // justification when the operator filled one in.
  const patches = await prisma.fl_Patch.findMany({
    where: {
      approvalState: { in: ["declined", "auto-declined", "deferred"] },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      source: true,
      sourceId: true,
      title: true,
      classification: true,
      approvalState: true,
      approvedBy: true,
      approvedAt: true,
      notes: true,
    },
  })
  const rows: string[][] = [[
    "patchId", "source", "sourceId", "title", "classification",
    "approvalState", "approvedBy", "approvedAt", "justification",
  ]]
  for (const p of patches) {
    rows.push([
      p.id,
      p.source,
      p.sourceId,
      p.title,
      p.classification,
      p.approvalState,
      p.approvedBy ?? "",
      p.approvedAt?.toISOString() ?? "",
      p.notes ?? "",
    ])
  }
  return toCsv(rows)
}

// ── Manifest + README ──────────────────────────────────────────────────────

interface ManifestInput {
  input: EvidenceZipInput
  auditChainTipHash: string | null
  auditChainIntact: boolean
  files: Array<{ name: string; sha256: string; bytes: number }>
}

function buildManifest(args: ManifestInput) {
  return {
    schemaVersion: 1,
    generatedAt: args.input.generatedAt.toISOString(),
    generatedBy: args.input.generatedBy ?? null,
    tenant: args.input.tenantName,
    reportId: args.input.reportId,
    reportKind: args.input.kind,
    audience: args.input.audience,
    period: {
      start: args.input.startDate.toISOString(),
      end: args.input.endDate.toISOString(),
    },
    auditChain: {
      tipHash: args.auditChainTipHash,
      intactAtPackageTime: args.auditChainIntact,
    },
    files: args.files,
    fleethubVersion: args.input.fleethubVersion,
    // Ed25519 manifest signature is reserved for step 11.5 once the
    // tenant compliance-key management surface lands. v1 leaves this
    // null; per-file sha256 + audit-chain tip hash are the integrity
    // guarantees for now.
    signature: null,
  }
}

interface ReadmeInput {
  input: EvidenceZipInput
  periodTag: string
  tenantSlug: string
}

function buildReadme(args: ReadmeInput): string {
  const { input } = args
  return [
    `FleetHub Evidence Package`,
    `=========================`,
    ``,
    `Tenant:       ${input.tenantName}`,
    `Report kind:  ${input.kind}`,
    `Audience:     ${input.audience}`,
    `Period:       ${input.startDate.toISOString().slice(0, 10)} to ${input.endDate.toISOString().slice(0, 10)}`,
    `Generated:    ${input.generatedAt.toISOString()}`,
    `Generated by: ${input.generatedBy ?? "(system)"}`,
    `FleetHub:     v${input.fleethubVersion}`,
    ``,
    `Contents`,
    `--------`,
    `  ${input.kind}-${args.tenantSlug}-${args.periodTag}.pdf`,
    `      Human-readable report for the period.`,
    `  ${input.kind}-${args.tenantSlug}-${args.periodTag}.csv`,
    `      Underlying per-row data the PDF was rendered from.`,
    `  audit-log-${args.tenantSlug}-${args.periodTag}.csv`,
    `      Append-only audit log slice for this tenant + global rows in`,
    `      the period.`,
    `  audit-chain-verification.txt`,
    `      Hash-chain continuity check at package-creation time. Re-run`,
    `      via GET /api/audit/verify (ADMIN session) to confirm the chain`,
    `      hasn't been edited since.`,
    `  deployments-${args.tenantSlug}-${args.periodTag}.csv`,
    `      Every Fl_Deployment in the period for this tenant + outcome`,
    `      counts.`,
    `  exceptions.csv`,
    `      Patches with approval state declined / deferred / auto-declined`,
    `      and the operator's justification (when filled in).`,
    `  manifest.json`,
    `      Per-file SHA-256 + audit-chain tip hash + report metadata.`,
    `      Ed25519 signature reserved for a future revision (signature=null`,
    `      in v1).`,
    ``,
    `Verifying integrity`,
    `-------------------`,
    `1. For each file in manifest.json:files[], compute SHA-256 and`,
    `   compare to the recorded hash. Any mismatch = file was modified`,
    `   after generation.`,
    `2. Compare manifest.json:auditChain.tipHash to a fresh GET on`,
    `   /api/audit/verify. The tip hash here must remain present in the`,
    `   live chain (the live tip moves forward over time, but every row`,
    `   up to and including this hash must stay intact).`,
    ``,
    `Questions: contact your MSP.`,
    ``,
  ].join("\n")
}

// ── helpers ────────────────────────────────────────────────────────────────

function slugifyTenant(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant"
}

function periodTagFor(start: Date, end: Date): string {
  // Same-day → just the date. Otherwise use start-end with hyphens.
  const s = start.toISOString().slice(0, 10)
  const e = end.toISOString().slice(0, 10)
  return s === e ? s : `${s}_to_${e}`
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsv).join(",")).join("\n") + "\n"
}

function escapeCsv(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function sha256Of(input: Buffer | string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function byteLength(input: Buffer | string): number {
  return typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.length
}

function hashRow(args: {
  prevHash: string | null
  actorEmail: string | null
  clientName: string | null
  deviceId: string | null
  action: string
  outcome: string
  detailJson: string | null
  createdAt: Date
}): string {
  const canonical = [
    args.prevHash ?? "",
    args.actorEmail ?? "",
    args.clientName ?? "",
    args.deviceId ?? "",
    args.action,
    args.outcome,
    args.detailJson ?? "",
    args.createdAt.toISOString(),
  ].join("|")
  return crypto.createHash("sha256").update(canonical).digest("hex")
}

// Used by buildPatchComplianceReport's signature so the orchestrator can
// keep import-graph minimal. Re-export from this file for symmetry.
export { buildPatchComplianceReport }
