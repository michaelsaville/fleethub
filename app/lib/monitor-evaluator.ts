import "server-only"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { writeAlert } from "@/lib/alert-dispatch"

// Phase 8 Workstream A step 1 — monitor evaluator. Cron at
// /api/cron/monitor-evaluate calls evaluateMonitors() every minute.
// For each active monitor:
//   1. Resolve the device set (tenantName + osFilter + deviceTag).
//   2. For each device, resolve the metric against the last
//      `forMin` minutes of telemetry (default 15).
//   3. If the predicate is true sustained for the full window AND
//      cooldown has lapsed, writeAlert() and log a Fl_MonitorFire.
//
// v1 metrics (perf.*) read Fl_PerformanceSample. The `inv.*` family
// lands when Fl_InventorySample does (WS-B). Each metric is a tiny
// resolver — adding a new one is a single entry in METRIC_RESOLVERS.
//
// Note: Fl_Monitor / Fl_MonitorFire models exist in the DB (raw
// DDL apply) but Prisma client hasn't been regenerated yet. Reads
// go through $queryRaw + writes through $executeRaw; the schema
// file mirrors the DDL so the next regen lines up.

interface MonitorRow {
  id: string
  name: string
  tenantName: string | null
  metric: string
  predicateJson: string
  severity: string
  emitKind: string
  cooldownMin: number
}

interface Predicate {
  operator: "lt" | "gt" | "eq" | "neq"
  value: number
  osFilter?: "windows" | "linux" | "darwin"
  deviceTag?: string
  forMin?: number
}

interface DeviceRow {
  id: string
  hostname: string
  clientName: string
  os: string | null
}

type MetricResolver = (deviceId: string, windowMin: number) => Promise<number[] | null>

// Performance-sample lookups use the 1h window rows. The evaluator
// looks back N minutes; we filter samples whose windowStart is
// inside [now - N, now]. With 1h windows that's typically 0–1
// samples for short forMin values — the "sustain" semantics fall
// back to "if any sample in the window violated the threshold."
// Sub-hour granularity lands when the agent emits finer-grain rows.
const PERF_WINDOW = "1h"

async function readPerf(
  deviceId: string,
  windowMin: number,
  field: "cpuAvgPct" | "cpuP95Pct" | "ramAvgPct" | "ramP95Pct" | "diskUsedPct",
): Promise<number[] | null> {
  const since = new Date(Date.now() - windowMin * 60_000)
  const samples = await prisma.fl_PerformanceSample.findMany({
    where: { deviceId, window: PERF_WINDOW, windowStart: { gte: since } },
    orderBy: { windowStart: "asc" },
    select: { [field]: true } as Record<string, boolean>,
  })
  if (samples.length === 0) return null
  return samples.map((s) => Number((s as unknown as Record<string, number>)[field]))
}

const METRIC_RESOLVERS: Record<string, MetricResolver> = {
  "perf.cpu.avg":      (id, w) => readPerf(id, w, "cpuAvgPct"),
  "perf.cpu.p95":      (id, w) => readPerf(id, w, "cpuP95Pct"),
  "perf.ram.avg":      (id, w) => readPerf(id, w, "ramAvgPct"),
  "perf.ram.p95":      (id, w) => readPerf(id, w, "ramP95Pct"),
  "perf.disk.percent": (id, w) => readPerf(id, w, "diskUsedPct"),
}

export const SUPPORTED_METRICS = Object.keys(METRIC_RESOLVERS)

function compare(observed: number, op: Predicate["operator"], threshold: number): boolean {
  switch (op) {
    case "lt":  return observed <  threshold
    case "gt":  return observed >  threshold
    case "eq":  return observed === threshold
    case "neq": return observed !== threshold
  }
}

function osMatches(deviceOs: string | null, filter: Predicate["osFilter"]): boolean {
  if (!filter) return true
  if (!deviceOs) return false
  return deviceOs.toLowerCase().includes(filter)
}

export interface EvaluationSummary {
  monitorsConsidered: number
  monitorsEvaluated: number
  firesRecorded: number
  firesSkippedCooldown: number
  firesSkippedNoData: number
  errors: Array<{ monitorId: string; error: string }>
}

export async function evaluateMonitors(now: Date = new Date()): Promise<EvaluationSummary> {
  // Load active monitors. `lastEvaluatedAt` is bumped at the bottom
  // regardless of whether the monitor fired — UI surfaces "n seconds
  // since last evaluation" so the operator can spot a stuck cron.
  const monitors = await prisma.$queryRaw<MonitorRow[]>`
    SELECT id, name, "tenantName", metric, "predicateJson", severity,
           "emitKind", "cooldownMin"
    FROM fleethub.fl_monitors
    WHERE "isActive" = true
  `

  const summary: EvaluationSummary = {
    monitorsConsidered: monitors.length,
    monitorsEvaluated: 0,
    firesRecorded: 0,
    firesSkippedCooldown: 0,
    firesSkippedNoData: 0,
    errors: [],
  }

  for (const m of monitors) {
    try {
      const resolver = METRIC_RESOLVERS[m.metric]
      if (!resolver) {
        summary.errors.push({ monitorId: m.id, error: `unknown metric "${m.metric}"` })
        continue
      }
      let predicate: Predicate
      try {
        predicate = JSON.parse(m.predicateJson) as Predicate
      } catch {
        summary.errors.push({ monitorId: m.id, error: "predicateJson is invalid JSON" })
        continue
      }
      if (!["lt", "gt", "eq", "neq"].includes(predicate.operator)) {
        summary.errors.push({ monitorId: m.id, error: `unknown operator "${predicate.operator}"` })
        continue
      }
      const windowMin = predicate.forMin && predicate.forMin > 0 ? predicate.forMin : 15

      // Device set — same filters every metric kind shares.
      const devices = await prisma.fl_Device.findMany({
        where: {
          isActive: true,
          maintenanceMode: false,
          ...(m.tenantName ? { clientName: m.tenantName } : {}),
        },
        select: { id: true, hostname: true, clientName: true, os: true },
      }) as DeviceRow[]

      summary.monitorsEvaluated += 1
      let monitorFiresThisRun = 0

      for (const d of devices) {
        if (!osMatches(d.os, predicate.osFilter)) continue
        // deviceTag filter deferred to when Fl_DeviceTag lands.

        const samples = await resolver(d.id, windowMin)
        if (!samples || samples.length === 0) {
          summary.firesSkippedNoData += 1
          continue
        }
        // "Sustain" semantics: every sample in the window must violate
        // the threshold. With 1h windows + short forMin that's
        // effectively "the most recent rollup" — fine for v1.
        const sustained = samples.every((v) => compare(v, predicate.operator, predicate.value))
        if (!sustained) continue

        // Cooldown lookup per (monitor, device).
        if (m.cooldownMin > 0) {
          const cooldownStart = new Date(now.getTime() - m.cooldownMin * 60_000)
          const recent = await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM fleethub.fl_monitor_fires
            WHERE "monitorId" = ${m.id}
              AND "deviceId"  = ${d.id}
              AND "firedAt" >= ${cooldownStart}
            LIMIT 1
          `
          if (recent.length > 0) {
            summary.firesSkippedCooldown += 1
            continue
          }
        }

        const observed = samples[samples.length - 1]
        let alertId: string | null = null
        try {
          const alert = await writeAlert({
            clientName: d.clientName,
            deviceId: d.id,
            kind: m.emitKind,
            severity: (m.severity === "critical" || m.severity === "info") ? m.severity : "warn",
            title: `${m.name} — ${d.hostname} (${m.metric} ${predicate.operator} ${predicate.value}, observed ${observed.toFixed(1)})`,
            detailJson: JSON.stringify({
              monitorId: m.id,
              monitorName: m.name,
              metric: m.metric,
              predicate,
              observedValue: observed,
              sampleCount: samples.length,
              windowMin,
            }),
          })
          alertId = alert.id
        } catch (err) {
          // writeAlert already audits dispatch failures; we still
          // record the fire so the operator sees that the monitor
          // tried to fire.
          summary.errors.push({
            monitorId: m.id,
            error: `writeAlert failed for device ${d.id}: ${(err as Error).message}`,
          })
        }

        await prisma.$executeRaw`
          INSERT INTO fleethub.fl_monitor_fires (id, "monitorId", "deviceId", "alertId", "observedValue", "firedAt")
          VALUES (${randomUUID()}, ${m.id}, ${d.id}, ${alertId}, ${observed}, ${now})
        `
        summary.firesRecorded += 1
        monitorFiresThisRun += 1
      }

      await prisma.$executeRaw`
        UPDATE fleethub.fl_monitors
        SET "lastEvaluatedAt" = ${now},
            "lastFiredAt" = CASE WHEN ${monitorFiresThisRun} > 0 THEN ${now} ELSE "lastFiredAt" END,
            "fireCount" = "fireCount" + ${monitorFiresThisRun},
            "updatedAt" = ${now}
        WHERE id = ${m.id}
      `
    } catch (err) {
      summary.errors.push({
        monitorId: m.id,
        error: `evaluator threw: ${(err as Error).message}`,
      })
    }
  }

  return summary
}
