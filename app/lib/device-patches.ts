import "server-only"
import { prisma } from "@/lib/prisma"

// Wave D — per-device patch readout. Reads Fl_PatchInstall joined with
// Fl_Patch metadata so the PatchesTab can render a real list rather
// than the inventory.snapshot sample.

export interface DevicePatchRow {
  installId: string
  patchId: string
  source: string
  sourceId: string
  title: string
  classification: string
  state: string
  approvalState: string
  isKev: boolean
  cvssMax: number | null
  requiresReboot: boolean | null
  lastDetectedAt: Date
  installedAt: Date | null
  failureReason: string | null
}

export interface DevicePatchSummary {
  missing: number
  installed: number
  failed: number
  superseded: number
  declined: number
  preflightFailed: number
  /** missing-and-KEV count — the "drop everything" bucket. */
  kevMissing: number
}

export async function getDevicePatches(
  deviceId: string,
  limit = 200,
): Promise<{ rows: DevicePatchRow[]; summary: DevicePatchSummary }> {
  const installs = await prisma.fl_PatchInstall.findMany({
    where: { deviceId },
    orderBy: [{ lastDetectedAt: "desc" }],
    take: limit,
    include: {
      patch: {
        select: {
          id: true,
          source: true,
          sourceId: true,
          title: true,
          classification: true,
          isKev: true,
          cvssMax: true,
          requiresReboot: true,
          approvalState: true,
        },
      },
    },
  })

  const rows: DevicePatchRow[] = installs.map((i) => ({
    installId: i.id,
    patchId: i.patchId,
    source: i.patch.source,
    sourceId: i.patch.sourceId,
    title: i.patch.title,
    classification: i.patch.classification,
    state: i.state,
    approvalState: i.patch.approvalState,
    isKev: i.patch.isKev,
    cvssMax: i.patch.cvssMax,
    requiresReboot: i.patch.requiresReboot,
    lastDetectedAt: i.lastDetectedAt,
    installedAt: i.installedAt,
    failureReason: i.failureReason,
  }))

  // Re-sort: KEV+missing on top, then missing by CVSS desc, then failed,
  // then everything else by lastDetectedAt desc.
  rows.sort((a, b) => {
    const bucket = (r: DevicePatchRow): number => {
      if (r.state === "missing" && r.isKev) return 0
      if (r.state === "missing") return 1
      if (r.state === "failed") return 2
      if (r.state === "preflight-failed") return 3
      if (r.state === "installed") return 4
      return 5
    }
    const ab = bucket(a)
    const bb = bucket(b)
    if (ab !== bb) return ab - bb
    if (ab === 1) {
      // missing-by-cvss desc
      return (b.cvssMax ?? 0) - (a.cvssMax ?? 0)
    }
    return b.lastDetectedAt.getTime() - a.lastDetectedAt.getTime()
  })

  const summary: DevicePatchSummary = {
    missing: 0,
    installed: 0,
    failed: 0,
    superseded: 0,
    declined: 0,
    preflightFailed: 0,
    kevMissing: 0,
  }
  for (const r of rows) {
    if (r.state === "missing") {
      summary.missing++
      if (r.isKev) summary.kevMissing++
    } else if (r.state === "installed") summary.installed++
    else if (r.state === "failed") summary.failed++
    else if (r.state === "superseded") summary.superseded++
    else if (r.state === "declined") summary.declined++
    else if (r.state === "preflight-failed") summary.preflightFailed++
  }

  return { rows, summary }
}
