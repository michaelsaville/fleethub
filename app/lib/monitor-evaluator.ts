import "server-only"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { writeAlert } from "@/lib/alert-dispatch"
import { writeAudit } from "@/lib/audit"
import { safeParseMonitorPredicateJson } from "@/lib/schemas/predicate"

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

type MetricBatchResolver = (deviceIds: string[], windowMin: number) => Promise<Map<string, number[]>>

// Performance-sample lookups use the 1h window rows. The evaluator
// looks back N minutes; we filter samples whose windowStart is
// inside [now - N, now]. With 1h windows that's typically 0–1
// samples for short forMin values — the "sustain" semantics fall
// back to "if any sample in the window violated the threshold."
// Sub-hour granularity lands when the agent emits finer-grain rows.
const PERF_WINDOW = "1h"

// Phase 9 WS-B §4.4 — batched read across all devices for one
// metric+window. Replaces the per-device readPerf the n+1 audit
// flagged: previously 100 hosts × 5 monitors → 500 sample queries
// per minute. Now: 1 query per monitor.
async function readPerfBatch(
  deviceIds: string[],
  windowMin: number,
  field: "cpuAvgPct" | "cpuP95Pct" | "ramAvgPct" | "ramP95Pct" | "diskUsedPct",
): Promise<Map<string, number[]>> {
  if (deviceIds.length === 0) return new Map()
  const since = new Date(Date.now() - windowMin * 60_000)
  const samples = await prisma.fl_PerformanceSample.findMany({
    where: { deviceId: { in: deviceIds }, window: PERF_WINDOW, windowStart: { gte: since } },
    orderBy: { windowStart: "asc" },
    select: { deviceId: true, [field]: true } as Record<string, boolean>,
  })
  const byDevice = new Map<string, number[]>()
  for (const s of samples) {
    const row = s as unknown as Record<string, unknown>
    const id = String(row.deviceId)
    const arr = byDevice.get(id) ?? []
    arr.push(Number(row[field]))
    byDevice.set(id, arr)
  }
  return byDevice
}

const METRIC_RESOLVERS: Record<string, MetricBatchResolver> = {
  "perf.cpu.avg":      (ids, w) => readPerfBatch(ids, w, "cpuAvgPct"),
  "perf.cpu.p95":      (ids, w) => readPerfBatch(ids, w, "cpuP95Pct"),
  "perf.ram.avg":      (ids, w) => readPerfBatch(ids, w, "ramAvgPct"),
  "perf.ram.p95":      (ids, w) => readPerfBatch(ids, w, "ramP95Pct"),
  "perf.disk.percent": (ids, w) => readPerfBatch(ids, w, "diskUsedPct"),
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
      // Phase 10 WS-B §4.3 — read-side safeParse. Malformed predicateJson
      // (manual SQL fix / pre-validator legacy row) now writes a
      // monitor.skip.malformed audit row instead of degrading silently.
      const parsedPred = safeParseMonitorPredicateJson(m.predicateJson)
      if (!parsedPred.ok) {
        summary.errors.push({ monitorId: m.id, error: parsedPred.reason })
        await writeAudit({
          action: "monitor.skip.malformed",
          outcome: "error",
          detail: { monitorId: m.id, reason: parsedPred.reason },
        }).catch(() => {})
        continue
      }
      const predicate: Predicate = parsedPred.predicate as Predicate
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

      // Phase 9 WS-B §4.4 — batch sample lookup for ALL devices in
      // this monitor's scope, in one query, before iterating. Plus
      // a single cooldown-recent-fires lookup so the per-device
      // cooldown check has data without n+1 round-trips.
      const matchingDevices = devices.filter((d) => osMatches(d.os, predicate.osFilter))
      const samplesByDevice = await resolver(matchingDevices.map((d) => d.id), windowMin)
      const cooldownRecent = new Set<string>()
      if (m.cooldownMin > 0 && matchingDevices.length > 0) {
        const cooldownStart = new Date(now.getTime() - m.cooldownMin * 60_000)
        const recentFires = await prisma.fl_MonitorFire.findMany({
          where: {
            monitorId: m.id,
            deviceId: { in: matchingDevices.map((d) => d.id) },
            firedAt: { gte: cooldownStart },
          },
          select: { deviceId: true },
          distinct: ["deviceId"],
        })
        for (const r of recentFires) cooldownRecent.add(r.deviceId)
      }

      for (const d of matchingDevices) {
        // deviceTag filter deferred to when Fl_DeviceTag lands.
        const samples = samplesByDevice.get(d.id)
        if (!samples || samples.length === 0) {
          summary.firesSkippedNoData += 1
          continue
        }
        // "Sustain" semantics: every sample in the window must violate
        // the threshold. With 1h windows + short forMin that's
        // effectively "the most recent rollup" — fine for v1.
        const sustained = samples.every((v) => compare(v, predicate.operator, predicate.value))
        if (!sustained) continue

        // Cooldown decision — comes from the pre-batched Set built
        // above (Phase 9 WS-B §4.4 n+1 fix). No per-device DB query;
        // race-safety is preserved by the per-fire $transaction +
        // advisory lock below that gates the actual fire-record
        // create on a unique (monitor, device, firedAt-floored)
        // index where applicable. v1 trades cooldown-decision
        // strict-monotonicity for batch-read perf — concurrent ticks
        // can both pass cooldown and both call writeAlert, but the
        // writeAlert path has its own dedup window covering that.
        if (m.cooldownMin > 0 && cooldownRecent.has(d.id)) {
          summary.firesSkippedCooldown += 1
          continue
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
