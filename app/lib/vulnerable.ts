import "server-only"
import { prisma } from "@/lib/prisma"

// Vulnerable-dashboard aggregation. Reads Fl_Patch + Fl_PatchAdvisory +
// Fl_PatchInstall to produce per-CVE rows: "CVE-2024-XXXX, KEV: yes,
// CVSS 9.8, 47 hosts missing the closing KB, ransomware-known".
//
// This is the read path PHASE-4-DESIGN §13 / §15 step 3 calls
// "sales-grade win even before deploys are possible."

export interface VulnerableRow {
  cveId: string
  cvssBase: number | null
  isKev: boolean
  ransomwareUseKnown: boolean
  vendor: string | null
  product: string | null
  description: string | null
  kevAddedAt: string | null
  /// Closing patches (one CVE may be closed by multiple KBs across
  /// product variants; we surface them all so the operator picks).
  closingPatches: VulnerableClosingPatch[]
  /// Total hosts missing AT LEAST ONE closing patch for this CVE.
  affectedDeviceCount: number
  /// Set of device IDs (capped at 200) for the deploy form's
  /// targets= URL parameter.
  affectedDeviceIds: string[]
}

export interface VulnerableClosingPatch {
  patchId: string
  source: string
  sourceId: string
  title: string
  isHotpatch: boolean
  approvalState: string
  missingDeviceCount: number
}

export async function getVulnerableRows(): Promise<VulnerableRow[]> {
  // 1. Pull all patches with non-empty cveJson + their per-host install
  //    state in one go.
  const patches = await prisma.fl_Patch.findMany({
    where: { cveJson: { not: null } },
    include: {
      installs: {
        where: { state: "missing" },
        select: { deviceId: true },
      },
    },
  })

  // 2. Build CVE → contributing-patches map.
  const cveToPatches: Map<string, VulnerableClosingPatch[]> = new Map()
  const cveToDeviceIds: Map<string, Set<string>> = new Map()

  for (const p of patches) {
    const cves = parseCveList(p.cveJson)
    if (cves.length === 0) continue
    const missing = p.installs.map((i) => i.deviceId)
    const closing: VulnerableClosingPatch = {
      patchId: p.id,
      source: p.source,
      sourceId: p.sourceId,
      title: p.title,
      isHotpatch: p.isHotpatch,
      approvalState: p.approvalState,
      missingDeviceCount: missing.length,
    }
    for (const cve of cves) {
      const list = cveToPatches.get(cve) ?? []
      list.push(closing)
      cveToPatches.set(cve, list)
      const set = cveToDeviceIds.get(cve) ?? new Set()
      for (const id of missing) set.add(id)
      cveToDeviceIds.set(cve, set)
    }
  }

  if (cveToPatches.size === 0) return []

  // 3. Pull advisory metadata for every CVE we found patches for.
  const cveIds = Array.from(cveToPatches.keys())
  const advisories = await prisma.fl_PatchAdvisory.findMany({
    where: { cveId: { in: cveIds } },
  })
  const advisoryByCve = new Map(advisories.map((a) => [a.cveId, a]))

  // 4. Compose rows. Sort: KEV first, then CVSS desc, then most-affected
  //    desc, then CVE id.
  const rows: VulnerableRow[] = cveIds.map((cveId) => {
    const adv = advisoryByCve.get(cveId)
    const closing = (cveToPatches.get(cveId) ?? []).sort((a, b) => b.missingDeviceCount - a.missingDeviceCount)
    const deviceSet = cveToDeviceIds.get(cveId) ?? new Set<string>()
    const affectedIds = Array.from(deviceSet).slice(0, 200)
    return {
      cveId,
      cvssBase: adv?.cvssBase ?? null,
      isKev: adv?.isKev ?? false,
      ransomwareUseKnown: adv?.ransomwareUseKnown ?? false,
      vendor: adv?.vendor ?? null,
      product: adv?.product ?? null,
      description: adv?.description ?? null,
      kevAddedAt: adv?.kevAddedAt?.toISOString() ?? null,
      closingPatches: closing,
      affectedDeviceCount: deviceSet.size,
      affectedDeviceIds: affectedIds,
    }
  })

  rows.sort((a, b) => {
    if (a.isKev !== b.isKev) return a.isKev ? -1 : 1
    const cv = (b.cvssBase ?? 0) - (a.cvssBase ?? 0)
    if (cv !== 0) return cv
    if (b.affectedDeviceCount !== a.affectedDeviceCount) return b.affectedDeviceCount - a.affectedDeviceCount
    return a.cveId.localeCompare(b.cveId)
  })

  return rows
}

function parseCveList(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === "string")
  } catch {
    return []
  }
}

export interface VulnerableSummary {
  totalCves: number
  kevCves: number
  ransomwareCves: number
  affectedDevices: number
  fullyPatchedDevices: number
  missingInstallRows: number
}

export async function getVulnerableSummary(): Promise<VulnerableSummary> {
  const [advisoriesAll, adviKev, adviRansom, missingInstalls, totalDevices] =
    await Promise.all([
      prisma.fl_PatchAdvisory.count(),
      prisma.fl_PatchAdvisory.count({ where: { isKev: true } }),
      prisma.fl_PatchAdvisory.count({ where: { ransomwareUseKnown: true } }),
      prisma.fl_PatchInstall.findMany({ where: { state: "missing" }, select: { deviceId: true } }),
      prisma.fl_Device.count({ where: { isActive: true } }),
    ])
  const affectedSet = new Set(missingInstalls.map((i) => i.deviceId))
  return {
    totalCves: advisoriesAll,
    kevCves: adviKev,
    ransomwareCves: adviRansom,
    affectedDevices: affectedSet.size,
    fullyPatchedDevices: totalDevices - affectedSet.size,
    missingInstallRows: missingInstalls.length,
  }
}
