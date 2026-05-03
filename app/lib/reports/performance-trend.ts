import "server-only"
import { prisma } from "@/lib/prisma"

// PHASE-5-DESIGN §3.3: Performance Trend.
//
// Time-series aggregation. Pulls Fl_PerformanceSample 1d window for the
// trend chart; falls back to 1h when 1d hasn't accumulated yet.
//
// Sections (audience-gated):
//   client      Fleet health (% over thresholds), high-level trend
//   tech        + Pressure list (top-N by hours-over-threshold)
//   auditor     + EOL/lifecycle aging full table

const CPU_PRESSURE_THRESHOLD = 80
const RAM_PRESSURE_THRESHOLD = 90
const DISK_PRESSURE_THRESHOLD = 90
const PRESSURE_LIST_LIMIT = 15

export interface PerformanceTrendData {
  tenantName: string
  asOf: Date
  startDate: Date
  endDate: Date
  audience: "tech" | "client" | "auditor"

  fleetHealth: {
    totalHosts: number
    sustainedHighCpu: number   // hosts with cpuP95 ≥ 80% across the window
    sustainedHighRam: number
    sustainedHighDisk: number
    monitoringGaps: number     // hosts with at least one missed-heartbeat sample
  }

  /** Per-day fleet-wide rollup. Used for the trend line on the PDF. */
  trendByDay: Array<{
    date: string  // YYYY-MM-DD
    cpuAvg: number
    ramAvg: number
    diskAvg: number
    hostCount: number
  }>

  /** Top-N hosts by hours over threshold. Limited to PRESSURE_LIST_LIMIT. */
  pressureList: Array<{
    hostname: string
    clientName: string
    samples: number
    cpuHoursOver: number   // count of 1h samples where cpuP95 ≥ threshold
    ramHoursOver: number
    diskHoursOver: number
  }>

  /** EOL: OS approaching support end + hardware older than 4 years. */
  eolHosts: Array<{
    hostname: string
    clientName: string
    os: string | null
    osVersion: string | null
    hardwareAgeYears: number | null
    eolReason: string
  }>
}

export async function buildPerformanceTrendReport(input: {
  tenantName: string
  startDate?: Date
  endDate?: Date
  asOf?: Date
  audience?: "tech" | "client" | "auditor"
}): Promise<PerformanceTrendData> {
  const audience = input.audience ?? "client"
  const endDate = input.endDate ?? input.asOf ?? new Date()
  const startDate = input.startDate ?? new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)

  const devices = await prisma.fl_Device.findMany({
    where: { clientName: input.tenantName, isActive: true },
    select: { id: true, hostname: true, clientName: true, os: true, osVersion: true, inventoryJson: true },
  })
  const deviceById = Object.fromEntries(devices.map((d) => [d.id, d]))
  const deviceIds = devices.map((d) => d.id)

  // 1. Hourly samples for the window — used for the pressure-list buckets.
  const hourlySamples = await prisma.fl_PerformanceSample.findMany({
    where: {
      deviceId: { in: deviceIds },
      window: "1h",
      windowStart: { gte: startDate, lte: endDate },
    },
  })

  // 2. Daily samples for the trend line. Falls back to derived-from-hourly
  //    if 1d tier hasn't run yet. Trimmed to the fields the trend chart
  //    actually consumes — synthesized rows lack id/createdAt so we don't
  //    typecheck against the full Prisma row.
  type TrendRow = {
    deviceId: string
    windowStart: Date
    cpuAvgPct: number
    ramAvgPct: number
    diskUsedPct: number
  }
  const dbDaily = await prisma.fl_PerformanceSample.findMany({
    where: {
      deviceId: { in: deviceIds },
      window: "1d",
      windowStart: { gte: startDate, lte: endDate },
    },
  })
  const dailySamples: TrendRow[] =
    dbDaily.length > 0 || hourlySamples.length === 0
      ? dbDaily
      : synthesizeDailyFromHourly(hourlySamples)

  // Fleet health — count distinct hosts with sustained (p95) over threshold.
  const cpuOver = new Set<string>()
  const ramOver = new Set<string>()
  const diskOver = new Set<string>()
  const monitoringGaps = new Set<string>()
  for (const s of hourlySamples) {
    if (s.cpuP95Pct >= CPU_PRESSURE_THRESHOLD) cpuOver.add(s.deviceId)
    if (s.ramP95Pct >= RAM_PRESSURE_THRESHOLD) ramOver.add(s.deviceId)
    if (s.diskUsedPct >= DISK_PRESSURE_THRESHOLD) diskOver.add(s.deviceId)
    if (s.missedHeartbeats > 0) monitoringGaps.add(s.deviceId)
  }

  // Trend by day.
  const trendBuckets = new Map<string, { cpu: number[]; ram: number[]; disk: number[]; hosts: Set<string> }>()
  for (const s of dailySamples) {
    const key = s.windowStart.toISOString().slice(0, 10)
    const bucket = trendBuckets.get(key) ?? { cpu: [], ram: [], disk: [], hosts: new Set() }
    bucket.cpu.push(s.cpuAvgPct)
    bucket.ram.push(s.ramAvgPct)
    bucket.disk.push(s.diskUsedPct)
    bucket.hosts.add(s.deviceId)
    trendBuckets.set(key, bucket)
  }
  const trendByDay = Array.from(trendBuckets.entries())
    .map(([date, b]) => ({
      date,
      cpuAvg: avg(b.cpu),
      ramAvg: avg(b.ram),
      diskAvg: avg(b.disk),
      hostCount: b.hosts.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Pressure list — count of 1h buckets above each threshold per host.
  const perHost = new Map<string, { samples: number; cpu: number; ram: number; disk: number }>()
  for (const s of hourlySamples) {
    const cur = perHost.get(s.deviceId) ?? { samples: 0, cpu: 0, ram: 0, disk: 0 }
    cur.samples++
    if (s.cpuP95Pct >= CPU_PRESSURE_THRESHOLD) cur.cpu++
    if (s.ramP95Pct >= RAM_PRESSURE_THRESHOLD) cur.ram++
    if (s.diskUsedPct >= DISK_PRESSURE_THRESHOLD) cur.disk++
    perHost.set(s.deviceId, cur)
  }
  const pressureList = Array.from(perHost.entries())
    .filter(([, v]) => v.cpu + v.ram + v.disk > 0)
    .map(([deviceId, v]) => {
      const d = deviceById[deviceId]
      return {
        hostname: d?.hostname ?? "(unknown)",
        clientName: d?.clientName ?? "-",
        samples: v.samples,
        cpuHoursOver: v.cpu,
        ramHoursOver: v.ram,
        diskHoursOver: v.disk,
      }
    })
    .sort((a, b) => (b.cpuHoursOver + b.ramHoursOver + b.diskHoursOver) - (a.cpuHoursOver + a.ramHoursOver + a.diskHoursOver))
    .slice(0, PRESSURE_LIST_LIMIT)

  // EOL / lifecycle.
  const eolHosts: PerformanceTrendData["eolHosts"] = []
  for (const d of devices) {
    let purchaseDate: string | null = null
    let osFromInventory: string | null = null
    try {
      if (d.inventoryJson) {
        const inv = JSON.parse(d.inventoryJson) as {
          hardware?: { purchaseDate?: string }
          os?: { family?: string; version?: string }
        }
        purchaseDate = inv.hardware?.purchaseDate ?? null
        osFromInventory = inv.os?.version ?? null
      }
    } catch { /* swallow malformed */ }

    const reasons: string[] = []
    let ageYears: number | null = null
    if (purchaseDate) {
      const age = (endDate.getTime() - new Date(purchaseDate).getTime()) / (365 * 24 * 60 * 60 * 1000)
      if (Number.isFinite(age)) {
        ageYears = Number(age.toFixed(1))
        if (age >= 4) reasons.push(`hardware ${ageYears}y old`)
      }
    }
    const osText = osFromInventory ?? d.osVersion ?? ""
    if (/Windows 10/i.test(osText)) reasons.push("Windows 10 EOL 2025-10-14")
    if (/Server 2012 R2/i.test(osText)) reasons.push("Server 2012 R2 EOL 2023-10-10")
    if (/Server 2016/i.test(osText)) reasons.push("Server 2016 mainstream end")

    if (reasons.length > 0) {
      eolHosts.push({
        hostname: d.hostname,
        clientName: d.clientName,
        os: d.os,
        osVersion: osFromInventory ?? d.osVersion ?? null,
        hardwareAgeYears: ageYears,
        eolReason: reasons.join(", "),
      })
    }
  }

  return {
    tenantName: input.tenantName,
    asOf: input.asOf ?? endDate,
    startDate,
    endDate,
    audience,
    fleetHealth: {
      totalHosts: devices.length,
      sustainedHighCpu: cpuOver.size,
      sustainedHighRam: ramOver.size,
      sustainedHighDisk: diskOver.size,
      monitoringGaps: monitoringGaps.size,
    },
    trendByDay,
    pressureList: audience === "client" ? [] : pressureList,
    eolHosts,
  }
}

// Synthesize daily samples by averaging hourly samples within each day.
// Used as a fallback when the daily rollup cron hasn't run yet.
function synthesizeDailyFromHourly(
  hourly: Array<{
    deviceId: string
    windowStart: Date
    cpuAvgPct: number
    ramAvgPct: number
    diskUsedPct: number
    cpuP95Pct: number
    ramP95Pct: number
    netInBytes: bigint
    netOutBytes: bigint
    uptimeSec: bigint
    missedHeartbeats: number
  }>,
): Array<{
  deviceId: string
  windowStart: Date
  cpuAvgPct: number
  ramAvgPct: number
  diskUsedPct: number
  cpuP95Pct: number
  ramP95Pct: number
  netInBytes: bigint
  netOutBytes: bigint
  uptimeSec: bigint
  missedHeartbeats: number
} & { window: string }> {
  const buckets = new Map<string, typeof hourly>()
  for (const s of hourly) {
    const dayStart = new Date(s.windowStart)
    dayStart.setUTCHours(0, 0, 0, 0)
    const key = `${s.deviceId}|${dayStart.toISOString()}`
    const arr = buckets.get(key) ?? []
    arr.push(s)
    buckets.set(key, arr)
  }
  return Array.from(buckets.entries()).map(([key, rows]) => {
    const [deviceId, isoStart] = key.split("|")
    return {
      deviceId,
      window: "1d",
      windowStart: new Date(isoStart),
      cpuAvgPct: avg(rows.map((r) => r.cpuAvgPct)),
      ramAvgPct: avg(rows.map((r) => r.ramAvgPct)),
      diskUsedPct: avg(rows.map((r) => r.diskUsedPct)),
      cpuP95Pct: Math.max(...rows.map((r) => r.cpuP95Pct)),
      ramP95Pct: Math.max(...rows.map((r) => r.ramP95Pct)),
      netInBytes: rows.reduce((a, r) => a + r.netInBytes, BigInt(0)),
      netOutBytes: rows.reduce((a, r) => a + r.netOutBytes, BigInt(0)),
      uptimeSec: rows.length > 0 ? rows.reduce((a, r) => a + r.uptimeSec, BigInt(0)) / BigInt(rows.length) : BigInt(0),
      missedHeartbeats: rows.reduce((a, r) => a + r.missedHeartbeats, 0),
    }
  })
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1))
}
