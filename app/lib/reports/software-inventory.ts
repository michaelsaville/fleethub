import "server-only"
import { prisma } from "@/lib/prisma"

// PHASE-5-DESIGN §3.2: Software Inventory.
//
// Pulls Fl_Package + Fl_PackageVersion + Fl_DeploymentTarget + per-host
// inventory.software (sample list on Fl_Device.inventoryJson).
//
// Audience-gated sections:
//   client       — catalog summary, drift counts, per-client footprint
//   tech         — adds heaviest hosts + recent deployments
//   auditor      — adds full per-package per-host drift list

export interface SoftwareInventoryData {
  tenantName: string
  asOf: Date
  audience: "tech" | "client" | "auditor"

  catalogSummary: {
    totalPackages: number
    approvedPackages: number
    /** Packages where at least one host has a non-default version installed. */
    packagesWithDrift: number
    /** Hosts where at least one tracked package is on an old version. */
    hostsOutdated: number
  }

  driftByPackage: Array<{
    packageName: string
    versions: Array<{ version: string; hostCount: number; isApprovedDefault: boolean }>
  }>

  /** Top-N hosts by installed-app count from inventory.software.sample. */
  heaviestHosts: Array<{
    hostname: string
    clientName: string
    installedCount: number
  }>

  /** "Acme has 47 of 60 catalog packages installed" rollup. */
  perClientFootprint: Array<{
    clientName: string
    hostCount: number
    averageInstalledCount: number
  }>

  recentDeployments: Array<{
    deploymentId: string
    packageName: string
    action: string
    requestedBy: string
    startedAt: string | null
    totalTargets: number
    succeeded: number
    failed: number
  }>
}

const HEAVIEST_LIMIT = 15
const RECENT_DEPLOYMENTS_LIMIT = 20

export async function buildSoftwareInventoryReport(input: {
  tenantName: string
  asOf?: Date
  audience?: "tech" | "client" | "auditor"
}): Promise<SoftwareInventoryData> {
  const audience = input.audience ?? "client"
  const asOf = input.asOf ?? new Date()

  const [packages, devices] = await Promise.all([
    prisma.fl_Package.findMany({
      where: { tenantName: input.tenantName, archivedAt: null },
      include: { versions: true },
    }),
    prisma.fl_Device.findMany({
      where: { clientName: input.tenantName, isActive: true },
      select: { id: true, hostname: true, clientName: true, inventoryJson: true },
    }),
  ])

  // Catalog summary
  const totalPackages = packages.length
  const approvedPackages = packages.filter((p) => p.isApproved).length

  // Drift detection: pull every Fl_DeploymentTarget for these packages,
  // group by detectedVersionPost. Anything not equal to the approved
  // default is drift.
  const packageIds = packages.map((p) => p.id)
  const targets = await prisma.fl_DeploymentTarget.findMany({
    where: { deployment: { packageId: { in: packageIds } } },
    include: { deployment: { select: { packageId: true, packageVersionId: true } } },
    orderBy: { completedAt: "desc" },
  })

  const driftMap = new Map<string, Map<string, Set<string>>>() // packageId → version → Set<deviceId>
  for (const t of targets) {
    if (!t.detectedVersionPost) continue
    const pkgId = t.deployment.packageId
    const versions = driftMap.get(pkgId) ?? new Map<string, Set<string>>()
    const ver = t.detectedVersionPost
    const hosts = versions.get(ver) ?? new Set<string>()
    hosts.add(t.deviceId)
    versions.set(ver, hosts)
    driftMap.set(pkgId, versions)
  }

  let packagesWithDrift = 0
  const hostsOutdated = new Set<string>()
  const driftByPackage: SoftwareInventoryData["driftByPackage"] = []
  for (const pkg of packages) {
    const versionMap = driftMap.get(pkg.id)
    if (!versionMap || versionMap.size === 0) continue
    const approvedDefault = pkg.versions.find((v) => v.isApprovedDefault)
    if (versionMap.size > 1) packagesWithDrift++
    const versions = Array.from(versionMap.entries())
      .map(([version, hosts]) => ({
        version,
        hostCount: hosts.size,
        isApprovedDefault: approvedDefault?.version === version,
      }))
      .sort((a, b) => b.hostCount - a.hostCount)
    for (const v of versions) {
      if (!v.isApprovedDefault) {
        for (const h of versionMap.get(v.version) ?? new Set()) hostsOutdated.add(h)
      }
    }
    driftByPackage.push({ packageName: pkg.name, versions })
  }

  // Heaviest hosts via inventory.software.sample length.
  const heaviestHosts = devices
    .map((d) => {
      let count = 0
      try {
        if (d.inventoryJson) {
          const inv = JSON.parse(d.inventoryJson) as { software?: { totalInstalled?: number } }
          count = inv.software?.totalInstalled ?? 0
        }
      } catch { /* malformed inventory — skip */ }
      return { hostname: d.hostname, clientName: d.clientName, installedCount: count }
    })
    .sort((a, b) => b.installedCount - a.installedCount)
    .slice(0, HEAVIEST_LIMIT)

  // Per-client footprint — even though report is per-tenant, "tenant" can
  // host multiple clientName values when scoped widely. v1 keeps it simple.
  const byClient = new Map<string, { hostCount: number; totalInstalled: number }>()
  for (const d of devices) {
    let installed = 0
    try {
      if (d.inventoryJson) {
        const inv = JSON.parse(d.inventoryJson) as { software?: { totalInstalled?: number } }
        installed = inv.software?.totalInstalled ?? 0
      }
    } catch { /* skip */ }
    const cur = byClient.get(d.clientName) ?? { hostCount: 0, totalInstalled: 0 }
    cur.hostCount++
    cur.totalInstalled += installed
    byClient.set(d.clientName, cur)
  }
  const perClientFootprint = Array.from(byClient.entries()).map(([clientName, v]) => ({
    clientName,
    hostCount: v.hostCount,
    averageInstalledCount: v.hostCount > 0 ? Math.round(v.totalInstalled / v.hostCount) : 0,
  }))

  // Recent deployments rollup.
  const recentDepRows = await prisma.fl_Deployment.findMany({
    where: { tenantName: input.tenantName },
    include: { package: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: RECENT_DEPLOYMENTS_LIMIT,
  })
  const recentDeployments: SoftwareInventoryData["recentDeployments"] = recentDepRows.map((d) => ({
    deploymentId: d.id,
    packageName: d.package.name,
    action: d.action,
    requestedBy: d.requestedBy,
    startedAt: d.startedAt ? d.startedAt.toISOString().slice(0, 10) : null,
    totalTargets: d.totalTargets,
    succeeded: d.succeededCount,
    failed: d.failedCount,
  }))

  return {
    tenantName: input.tenantName,
    asOf,
    audience,
    catalogSummary: {
      totalPackages,
      approvedPackages,
      packagesWithDrift,
      hostsOutdated: hostsOutdated.size,
    },
    driftByPackage,
    heaviestHosts: audience === "client" ? [] : heaviestHosts,
    perClientFootprint,
    recentDeployments: audience === "auditor" ? [] : recentDeployments,
  }
}
