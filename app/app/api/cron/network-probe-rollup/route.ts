import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/with-cron-auth"

// Phase 12 WS-A.5 — hourly rollup of Fl_NetworkProbe into
// Fl_NetworkProbeHour.
//
// Cadence: hourly. Aggregates the PRIOR full hour (rounded to top
// of hour). Per device, computes p50/p95/p99 over ok=true probes,
// loss% over all probes, and sampleCount.
//
// Materialized (not a view) per architect §5 — every chart render
// would re-scan the 2.16M-row fact-table otherwise.

export const dynamic = "force-dynamic"
export const maxDuration = 60

interface ProbeRow {
  rttMs: number | null
  ok: boolean
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
  return sorted[idx]
}

export const POST = withCronAuth(async (_req: NextRequest) => {
  const now = new Date()
  // Top-of-prior-hour: e.g. if now is 03:42 UTC, target is 02:00.
  const targetHour = new Date(now)
  targetHour.setUTCMinutes(0, 0, 0)
  targetHour.setUTCHours(targetHour.getUTCHours() - 1)
  const hourStart = targetHour
  const hourEnd = new Date(hourStart.getTime() + 60 * 60_000)

  const devices = await prisma.fl_NetworkDevice.findMany({
    where: { isActive: true },
    select: { id: true },
  })
  let upserts = 0
  for (const d of devices) {
    const rows: ProbeRow[] = await prisma.fl_NetworkProbe.findMany({
      where: {
        networkDeviceId: d.id,
        ts: { gte: hourStart, lt: hourEnd },
        kind: "icmp",
      },
      select: { rttMs: true, ok: true },
    })
    if (rows.length === 0) continue
    const okRtts = rows
      .filter((r) => r.ok && r.rttMs != null)
      .map((r) => r.rttMs!) // we filtered nulls
      .sort((a, b) => a - b)
    const sampleCount = rows.length
    const losses = rows.filter((r) => !r.ok).length
    const lossPct = sampleCount > 0 ? (losses / sampleCount) * 100 : 0

    await prisma.fl_NetworkProbeHour.upsert({
      where: {
        networkDeviceId_hour: {
          networkDeviceId: d.id,
          hour: hourStart,
        },
      },
      create: {
        networkDeviceId: d.id,
        hour: hourStart,
        p50Ms: quantile(okRtts, 0.5),
        p95Ms: quantile(okRtts, 0.95),
        p99Ms: quantile(okRtts, 0.99),
        lossPct,
        sampleCount,
      },
      update: {
        p50Ms: quantile(okRtts, 0.5),
        p95Ms: quantile(okRtts, 0.95),
        p99Ms: quantile(okRtts, 0.99),
        lossPct,
        sampleCount,
      },
    })
    upserts++
  }

  return NextResponse.json({
    ok: true,
    hour: hourStart.toISOString(),
    devicesScanned: devices.length,
    upserts,
  })
})
