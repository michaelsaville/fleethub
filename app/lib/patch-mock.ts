import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// Mock MS KB catalog + per-host install-state seed.
//
// Real Microsoft Update Catalog has no clean public API (PHASE-4-DESIGN
// §16 open question). For v1 we hand-curate a set of recent
// high-impact KBs with their CVE links, then mock-distribute install
// state across the existing fleet so the Vulnerable dashboard
// renders against real-shaped data.
//
// Becomes dead code once real ingest lands (agent-aggregated WUA
// data per design §16 option b, or partner third-party feed).

interface MockPatchSpec {
  source: "ms" | "thirdparty"
  sourceId: string  // KB number for MS, vendor canonical id for 3rd-party
  title: string
  classification: "security" | "critical" | "rollup" | "feature" | "definition" | "third-party"
  cves: string[]    // these MUST be real CVE ids; CISA KEV ingest
                    // links them when they're listed there
  isHotpatch?: boolean
  requiresReboot?: boolean
  publishedAt?: string  // YYYY-MM-DD
  os: "windows" | "macos" | "linux" | "any"
}

// 24 hand-curated patches: a mix of well-known critical KBs that map
// to real CVEs (some KEV-listed, some not), plus a few third-party
// app patches. Tech-recognizable so the demo lands.
const SEED_PATCHES: MockPatchSpec[] = [
  // ─── Microsoft KBs ─────────────────────────────────────────────────
  {
    source: "ms",
    sourceId: "KB5036893",
    title: "2024-04 Cumulative Update for Windows 11 Version 23H2",
    classification: "security",
    cves: ["CVE-2024-26234", "CVE-2024-29988"],
    requiresReboot: true,
    publishedAt: "2024-04-09",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5034441",
    title: "2024-01 Security Update for Windows Recovery Environment",
    classification: "security",
    cves: ["CVE-2024-20666"],
    requiresReboot: true,
    publishedAt: "2024-01-09",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5034122",
    title: "2024-01 Cumulative Update for Windows 10 Version 22H2",
    classification: "security",
    cves: ["CVE-2024-20674", "CVE-2024-20653"],
    requiresReboot: true,
    publishedAt: "2024-01-09",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5036900",
    title: "2024-04 Cumulative Update for Windows 10 Version 22H2",
    classification: "security",
    cves: ["CVE-2024-26209", "CVE-2024-29063"],
    requiresReboot: true,
    publishedAt: "2024-04-09",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5040434",
    title: "2024-07 Cumulative Update for Windows 11 Version 23H2",
    classification: "security",
    cves: ["CVE-2024-38080", "CVE-2024-38112"],
    requiresReboot: true,
    publishedAt: "2024-07-09",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5044277",
    title: "2024-10 Cumulative Update for Windows 11 Version 23H2",
    classification: "security",
    cves: ["CVE-2024-43572", "CVE-2024-43573", "CVE-2024-43583"],
    requiresReboot: true,
    publishedAt: "2024-10-08",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5050009",
    title: "2025-01 Cumulative Update for Windows 11 Version 24H2",
    classification: "security",
    cves: ["CVE-2025-21333", "CVE-2025-21334", "CVE-2025-21335"],
    requiresReboot: true,
    publishedAt: "2025-01-14",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5042881",
    title: "2024-08 Cumulative Update for Windows Server 2022",
    classification: "security",
    cves: ["CVE-2024-38063"],
    requiresReboot: true,
    publishedAt: "2024-08-13",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5028166",
    title: "2023-07 Cumulative Update for Windows 11 (PrintNightmare)",
    classification: "security",
    cves: ["CVE-2023-32049", "CVE-2023-35311"],
    requiresReboot: true,
    publishedAt: "2023-07-11",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5025221",
    title: "2023-04 Cumulative Update for Windows 11 (Outlook NTLM relay)",
    classification: "security",
    cves: ["CVE-2023-23397"],
    requiresReboot: true,
    publishedAt: "2023-04-11",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5005565",
    title: "2021-09 Cumulative Update for Windows 10 (PrintNightmare 2)",
    classification: "security",
    cves: ["CVE-2021-36958"],
    requiresReboot: true,
    publishedAt: "2021-09-14",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5068966",
    title: "Hotpatch for Windows 11 / Server 2025 (no-restart)",
    classification: "security",
    cves: [],
    isHotpatch: true,
    requiresReboot: false,
    publishedAt: "2026-04-08",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5012170",
    title: "Security Update for Secure Boot DBX",
    classification: "security",
    cves: ["CVE-2023-24932"],
    requiresReboot: true,
    publishedAt: "2023-05-09",
    os: "windows",
  },
  {
    source: "ms",
    sourceId: "KB5034740",
    title: "2024-02 Defender Antimalware definition update",
    classification: "definition",
    cves: [],
    requiresReboot: false,
    publishedAt: "2024-02-13",
    os: "windows",
  },

  // ─── Third-party (vendor-curated catalog) ─────────────────────────
  {
    source: "thirdparty",
    sourceId: "Google.Chrome@126.0.6478.62",
    title: "Google Chrome 126.0.6478.62 (security)",
    classification: "third-party",
    cves: ["CVE-2024-6101", "CVE-2024-6102"],
    requiresReboot: false,
    publishedAt: "2024-06-18",
    os: "any",
  },
  {
    source: "thirdparty",
    sourceId: "Adobe.Acrobat.DC@2024.002.20991",
    title: "Adobe Acrobat Reader DC 2024.002.20991 (security)",
    classification: "third-party",
    cves: ["CVE-2024-30284", "CVE-2024-30310"],
    requiresReboot: false,
    publishedAt: "2024-04-09",
    os: "windows",
  },
  {
    source: "thirdparty",
    sourceId: "Mozilla.Firefox@127.0.1",
    title: "Mozilla Firefox 127.0.1",
    classification: "third-party",
    cves: ["CVE-2024-6602"],
    requiresReboot: false,
    publishedAt: "2024-06-25",
    os: "any",
  },
  {
    source: "thirdparty",
    sourceId: "7-Zip@24.07",
    title: "7-Zip 24.07 (Mark-of-the-Web bypass)",
    classification: "third-party",
    cves: ["CVE-2025-0411"],
    requiresReboot: false,
    publishedAt: "2024-06-19",
    os: "windows",
  },
  {
    source: "thirdparty",
    sourceId: "Zoom.Workplace@6.0.10",
    title: "Zoom Workplace 6.0.10",
    classification: "third-party",
    cves: ["CVE-2024-39825"],
    requiresReboot: false,
    publishedAt: "2024-06-11",
    os: "any",
  },
  {
    source: "thirdparty",
    sourceId: "Notepad++@8.6.7",
    title: "Notepad++ 8.6.7 (XML parser)",
    classification: "third-party",
    cves: ["CVE-2024-3933"],
    requiresReboot: false,
    publishedAt: "2024-04-22",
    os: "windows",
  },
  {
    source: "thirdparty",
    sourceId: "Oracle.Java@8u421",
    title: "Java SE 8 Update 421 (CPU)",
    classification: "third-party",
    cves: ["CVE-2024-21131", "CVE-2024-21138"],
    requiresReboot: false,
    publishedAt: "2024-07-16",
    os: "any",
  },
  {
    source: "thirdparty",
    sourceId: "Mozilla.Thunderbird@128.0",
    title: "Mozilla Thunderbird 128.0",
    classification: "third-party",
    cves: ["CVE-2024-6603"],
    requiresReboot: false,
    publishedAt: "2024-07-09",
    os: "any",
  },
  {
    source: "thirdparty",
    sourceId: "VLC.MediaPlayer@3.0.21",
    title: "VLC Media Player 3.0.21",
    classification: "third-party",
    cves: ["CVE-2024-29043"],
    requiresReboot: false,
    publishedAt: "2024-05-31",
    os: "any",
  },
  {
    source: "thirdparty",
    sourceId: "PuTTY@0.81",
    title: "PuTTY 0.81 (key recovery via biased nonces)",
    classification: "third-party",
    cves: ["CVE-2024-31497"],
    requiresReboot: false,
    publishedAt: "2024-04-15",
    os: "any",
  },
]

export interface SeedResult {
  patchesUpserted: number
  installRowsCreated: number
  patchInstallSummary: { kbId: string; missingDeviceCount: number }[]
}

export async function seedPatchesAndInstalls(actorEmail: string): Promise<SeedResult> {
  // 1. Upsert all seed patches.
  let patchesUpserted = 0
  for (const spec of SEED_PATCHES) {
    await prisma.fl_Patch.upsert({
      where: { source_sourceId: { source: spec.source, sourceId: spec.sourceId } },
      create: {
        source: spec.source,
        sourceId: spec.sourceId,
        os: spec.os,
        title: spec.title,
        classification: spec.classification,
        cveJson: spec.cves.length > 0 ? JSON.stringify(spec.cves) : null,
        isKev: false,  // bumped by reflag-after-CVE-ingest
        isHotpatch: !!spec.isHotpatch,
        requiresReboot: spec.requiresReboot ?? null,
        publishedAt: spec.publishedAt ? new Date(spec.publishedAt) : null,
        approvalState: "needs-approval",
      },
      update: {
        title: spec.title,
        classification: spec.classification,
        cveJson: spec.cves.length > 0 ? JSON.stringify(spec.cves) : null,
        publishedAt: spec.publishedAt ? new Date(spec.publishedAt) : null,
      },
    })
    patchesUpserted++
  }

  // 2. Mock per-host install state. For each patch + each device whose
  //    OS matches, randomly mark ~30% missing. Deterministic per
  //    (deviceId, patchId) so re-seeding doesn't churn the dataset.
  const allPatches = await prisma.fl_Patch.findMany({ select: { id: true, os: true } })
  const allDevices = await prisma.fl_Device.findMany({
    where: { isActive: true },
    select: { id: true, os: true },
  })
  let installRowsCreated = 0
  for (const patch of allPatches) {
    const eligibleDevices = allDevices.filter((d) => {
      if (patch.os === "any") return true
      return d.os === patch.os
    })
    for (const device of eligibleDevices) {
      // Stable hash → 0..99 outcome per (device, patch) so re-seeds
      // produce the same distribution.
      const bucket = stableBucket(device.id, patch.id)
      const state =
        bucket < 30 ? "missing" :
        bucket < 90 ? "installed" :
        "failed"
      try {
        await prisma.fl_PatchInstall.upsert({
          where: { deviceId_patchId: { deviceId: device.id, patchId: patch.id } },
          create: {
            deviceId: device.id,
            patchId: patch.id,
            state,
            wmiQfe: state === "installed",
            dismPackages: state === "installed",
            wuHistory: state === "installed",
            lastDetectedAt: new Date(),
            installedAt: state === "installed" ? new Date(Date.now() - bucket * 86_400_000) : null,
            failureReason: state === "failed" ? "Mock: install pending operator review" : null,
          },
          update: {
            // Don't churn existing real data on re-seed.
            lastDetectedAt: new Date(),
          },
        })
        installRowsCreated++
      } catch {
        // FK violation if device was deleted between findMany and upsert — skip.
      }
    }
  }

  // 3. Build a summary of missing-host count per patch for the audit row.
  const patchInstallSummary: { kbId: string; missingDeviceCount: number }[] = []
  const groups = await prisma.fl_PatchInstall.groupBy({
    by: ["patchId"],
    where: { state: "missing" },
    _count: { _all: true },
  })
  const patchIdToKb = new Map(
    (await prisma.fl_Patch.findMany({ select: { id: true, sourceId: true } })).map((p) => [p.id, p.sourceId]),
  )
  for (const g of groups) {
    const kb = patchIdToKb.get(g.patchId)
    if (kb) patchInstallSummary.push({ kbId: kb, missingDeviceCount: g._count._all })
  }

  await writeAudit({
    actorEmail,
    action: "patch.mock.seed",
    outcome: "ok",
    detail: { patchesUpserted, installRowsCreated, patchInstallSummary: patchInstallSummary.slice(0, 8) },
  })

  return { patchesUpserted, installRowsCreated, patchInstallSummary }
}

function stableBucket(deviceId: string, patchId: string): number {
  let h = 0
  const s = `${deviceId}|${patchId}`
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 100
}
