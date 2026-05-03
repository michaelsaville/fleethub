import "server-only"
import { prisma } from "@/lib/prisma"

// Performance time-series rollup (PHASE-5-DESIGN §6).
//
// Tier semantics:
//   1h — kept 30 days, the high-resolution working set
//   1d — kept 13 months, trend-chart data source
//   7d — kept 6 years, long-term retention matching HIPAA
//
// Pragmatic v1 shortcut vs the design: the agent's inventory.report
// already pre-aggregates the signals into health.{cpu7d, ramPct, diskPct}
// (see cmd/agent/inventory.go). It does NOT push a 1-minute raw stream.
// So the 1h tier here SAMPLES the current health snapshot once per
// run rather than aggregating raw 1-minute rows. Functionally serves
// the trend-chart data path; deviates from the design's "pre-compute
// from raw samples" wording. Documented in §6.
//
// 1d and 7d tiers genuinely roll up the prior tier's rows (avg-of-avgs,
// max-as-p95-proxy). When the agent eventually ships raw 1-minute
// samples (Phase 5.5+), the 1h tier swaps to a real aggregation; the
// 1d/7d tiers are unaffected.

interface DeviceHealth {
  cpu7d: number
  ramPct: number
  diskPct: number
}

function readHealth(inventoryJson: string | null): DeviceHealth | null {
  if (!inventoryJson) return null
  try {
    const inv = JSON.parse(inventoryJson) as { health?: Partial<DeviceHealth> }
    if (!inv.health) return null
    const h = inv.health
    if (typeof h.cpu7d !== "number" || typeof h.ramPct !== "number" || typeof h.diskPct !== "number") {
      return null
    }
    return { cpu7d: h.cpu7d, ramPct: h.ramPct, diskPct: h.diskPct }
  } catch {
    return null
  }
}

function readUptime(inventoryJson: string | null, lastBootAt: Date | null): bigint {
  // Best-effort: derive uptime from os.lastBootAt if present.
  try {
    const inv = inventoryJson ? (JSON.parse(inventoryJson) as { os?: { lastBootAt?: string } }) : null
    const boot = inv?.os?.lastBootAt ? new Date(inv.os.lastBootAt) : lastBootAt
    if (!boot) return BigInt(0)
    return BigInt(Math.max(0, Math.floor((Date.now() - boot.getTime()) / 1000)))
  } catch {
    return BigInt(0)
  }
}

function bucketStart(now: Date, tier: "1h" | "1d" | "7d"): Date {
  const d = new Date(now)
  d.setUTCMinutes(0, 0, 0)
  if (tier === "1d" || tier === "7d") {
    d.setUTCHours(0)
  }
  if (tier === "7d") {
    // Align to ISO week start (Monday).
    const day = d.getUTCDay() || 7 // Sunday → 7 so Monday→1 stays 1
    d.setUTCDate(d.getUTCDate() - (day - 1))
  }
  return d
}

// rollupHour samples the current Fl_Device inventory snapshot for every
// online host and writes (or upserts) a 1h Fl_PerformanceSample row.
// Returns the count of rows written.
export async function rollupHour(now: Date = new Date()): Promise<{ samples: number; skipped: number }> {
  const devices = await prisma.fl_Device.findMany({
    where: { isActive: true },
    select: { id: true, inventoryJson: true, lastSeenAt: true, isOnline: true },
  })
  let samples = 0, skipped = 0
  const windowStart = bucketStart(now, "1h")
  for (const d of devices) {
    const h = readHealth(d.inventoryJson)
    if (!h) { skipped++; continue }
    const uptime = readUptime(d.inventoryJson, null)
    // Heartbeat-miss heuristic: if the device hasn't been seen this hour,
    // count it as missing the bucket. Refined once we have real heartbeat
    // counters per-bucket.
    const missed = !d.lastSeenAt || d.lastSeenAt < windowStart ? 1 : 0
    await prisma.fl_PerformanceSample.upsert({
      where: { deviceId_window_windowStart: { deviceId: d.id, window: "1h", windowStart } },
      create: {
        deviceId: d.id,
        window: "1h",
        windowStart,
        cpuAvgPct: h.cpu7d,
        cpuP95Pct: h.cpu7d, // p95 not separated by agent; pre-aggregated avg used as both
        ramAvgPct: h.ramPct,
        ramP95Pct: h.ramPct,
        diskUsedPct: h.diskPct,
        uptimeSec: uptime,
        missedHeartbeats: missed,
      },
      update: {
        cpuAvgPct: h.cpu7d,
        cpuP95Pct: h.cpu7d,
        ramAvgPct: h.ramPct,
        ramP95Pct: h.ramPct,
        diskUsedPct: h.diskPct,
        uptimeSec: uptime,
        missedHeartbeats: missed,
      },
    })
    samples++
  }
  return { samples, skipped }
}

// rollupTier rolls a finer tier into a coarser tier (1h → 1d → 7d).
// Pulls all source-tier rows whose windowStart falls inside the target
// bucket and computes (avg-of-avgs, max-as-p95-proxy, mean uptime,
// summed heartbeat misses).
async function rollupTier(
  now: Date,
  source: "1h" | "1d",
  target: "1d" | "7d",
): Promise<{ samples: number }> {
  const targetStart = bucketStart(now, target)
  const targetEnd = new Date(targetStart)
  if (target === "1d") targetEnd.setUTCDate(targetEnd.getUTCDate() + 1)
  if (target === "7d") targetEnd.setUTCDate(targetEnd.getUTCDate() + 7)

  const sourceRows = await prisma.fl_PerformanceSample.findMany({
    where: {
      window: source,
      windowStart: { gte: targetStart, lt: targetEnd },
    },
  })
  // Group by deviceId.
  const grouped = new Map<string, typeof sourceRows>()
  for (const r of sourceRows) {
    const arr = grouped.get(r.deviceId) ?? []
    arr.push(r)
    grouped.set(r.deviceId, arr)
  }

  let samples = 0
  for (const [deviceId, rows] of grouped) {
    if (rows.length === 0) continue
    const cpuAvg = avg(rows.map((r) => r.cpuAvgPct))
    const cpuP95 = Math.max(...rows.map((r) => r.cpuP95Pct))
    const ramAvg = avg(rows.map((r) => r.ramAvgPct))
    const ramP95 = Math.max(...rows.map((r) => r.ramP95Pct))
    const diskUsed = avg(rows.map((r) => r.diskUsedPct))
    const netIn = rows.reduce((acc, r) => acc + r.netInBytes, BigInt(0))
    const netOut = rows.reduce((acc, r) => acc + r.netOutBytes, BigInt(0))
    const uptime = rows.length > 0
      ? rows.reduce((acc, r) => acc + r.uptimeSec, BigInt(0)) / BigInt(rows.length)
      : BigInt(0)
    const missed = rows.reduce((acc, r) => acc + r.missedHeartbeats, 0)

    await prisma.fl_PerformanceSample.upsert({
      where: { deviceId_window_windowStart: { deviceId, window: target, windowStart: targetStart } },
      create: {
        deviceId,
        window: target,
        windowStart: targetStart,
        cpuAvgPct: cpuAvg,
        cpuP95Pct: cpuP95,
        ramAvgPct: ramAvg,
        ramP95Pct: ramP95,
        diskUsedPct: diskUsed,
        netInBytes: netIn,
        netOutBytes: netOut,
        uptimeSec: uptime,
        missedHeartbeats: missed,
      },
      update: {
        cpuAvgPct: cpuAvg,
        cpuP95Pct: cpuP95,
        ramAvgPct: ramAvg,
        ramP95Pct: ramP95,
        diskUsedPct: diskUsed,
        netInBytes: netIn,
        netOutBytes: netOut,
        uptimeSec: uptime,
        missedHeartbeats: missed,
      },
    })
    samples++
  }
  return { samples }
}

export async function rollupDay(now: Date = new Date()) {
  return rollupTier(now, "1h", "1d")
}

export async function rollupWeek(now: Date = new Date()) {
  return rollupTier(now, "1d", "7d")
}

// runRollup picks the tier from the bearer endpoint's query string.
export async function runRollup(tier: "hour" | "day" | "week") {
  if (tier === "hour") return rollupHour()
  if (tier === "day") return rollupDay()
  if (tier === "week") return rollupWeek()
  throw new Error(`unknown tier: ${tier}`)
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
