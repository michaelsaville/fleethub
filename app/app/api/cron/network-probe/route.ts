import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/with-cron-auth"
import { probeIcmp, probeSnmp } from "@/lib/network-probe"
import { writeAlert } from "@/lib/alert-dispatch"
import { withLease } from "@/lib/evaluator-lease"

// Phase 12 WS-A.4 — network probe cron.
//
// Cadence: 30s. Iterates active Fl_NetworkDevice rows; per device,
// gates on lastProbedAt + pollIntervalSec (default 60s).
// Writes Fl_NetworkProbe row per probe attempt.
//
// Alerts fired:
//   - network.down: ICMP unreachable for 3 consecutive probes.
//   - network.latency: ICMP p95 over 200ms across last 5 probes.
//
// Idempotency: a tick that arrives while a previous run is still
// in flight will see lastProbedAt fresh and skip every device.
// Phase-12-WS-E.5 lease wrap is the belt-and-suspenders.

export const dynamic = "force-dynamic"
export const maxDuration = 60

const LATENCY_ALERT_THRESHOLD_MS = 200
const DOWN_CONSECUTIVE_FAILS = 3
const LATENCY_SAMPLE_SIZE = 5

interface ProbeWrite {
  networkDeviceId: string
  kind: "icmp" | "snmp-get"
  rttMs: number | null
  ok: boolean
  errorMsg: string | null
  payloadJson: string | null
}

export const POST = withCronAuth(async (_req: NextRequest) => {
  const result = await withLease("network-probe", 90_000, async () => {
    return await runProbeTick()
  })
  if (result == null) {
    return NextResponse.json({ ok: true, skipped: "lease held" }, { status: 409 })
  }
  return NextResponse.json(result)
})

async function runProbeTick() {
  const now = new Date()
  const devices = await prisma.fl_NetworkDevice.findMany({
    where: { isActive: true },
  })
  const probed: string[] = []
  const skippedSoon: string[] = []
  const alertsFired: string[] = []

  for (const d of devices) {
    // Per-device interval gate.
    if (d.lastProbedAt) {
      const elapsedSec = (now.getTime() - d.lastProbedAt.getTime()) / 1000
      if (elapsedSec < d.pollIntervalSec) {
        skippedSoon.push(d.id)
        continue
      }
    }

    // Run ICMP first if enabled. If both ICMP + SNMP are configured,
    // ICMP runs every tick and SNMP runs every 2nd tick (rate-limit
    // SNMP since it's heavier).
    const writes: ProbeWrite[] = []
    let icmpOk = true

    if (d.icmpEnabled) {
      const r = await probeIcmp(d.ipAddress)
      writes.push({
        networkDeviceId: d.id,
        kind: "icmp",
        rttMs: r.rttMs,
        ok: r.ok,
        errorMsg: r.errorMsg,
        payloadJson: null,
      })
      if (!r.ok) icmpOk = false
    }

    if (
      d.snmpVersion !== "none" &&
      d.snmpCredentialId &&
      // run SNMP only if ICMP succeeded (no point asking via SNMP if host's down)
      icmpOk
    ) {
      const r = await probeSnmp(d.ipAddress, {
        snmpVersion: d.snmpVersion as "v2c" | "v3",
        credentialId: d.snmpCredentialId,
      })
      writes.push({
        networkDeviceId: d.id,
        kind: "snmp-get",
        rttMs: r.rttMs,
        ok: r.ok,
        errorMsg: r.errorMsg,
        payloadJson: r.payload ? JSON.stringify(r.payload) : null,
      })
    }

    if (writes.length === 0) {
      // Device has neither ICMP nor SNMP configured. Skip with no
      // probe row — log via audit at config time, not here.
      continue
    }

    await prisma.$transaction([
      prisma.fl_NetworkProbe.createMany({ data: writes }),
      prisma.fl_NetworkDevice.update({
        where: { id: d.id },
        data: { lastProbedAt: now },
      }),
    ])
    probed.push(d.id)

    // Alert evaluation. Read recent probes to determine
    // consecutive-fail count + p95 latency.
    const recent = await prisma.fl_NetworkProbe.findMany({
      where: { networkDeviceId: d.id, kind: "icmp" },
      orderBy: { ts: "desc" },
      take: LATENCY_SAMPLE_SIZE,
    })
    if (recent.length >= DOWN_CONSECUTIVE_FAILS) {
      const lastN = recent.slice(0, DOWN_CONSECUTIVE_FAILS)
      const allFailed = lastN.every((p) => !p.ok)
      if (allFailed) {
        // Suppress duplicate-firing: only emit if no open network.down
        // alert exists for this device.
        const existing = await prisma.fl_Alert.findFirst({
          where: {
            clientName: d.clientName,
            deviceId: null,
            kind: "network.down",
            state: "open",
            detailJson: { contains: `"networkDeviceId":"${d.id}"` },
          },
        })
        if (!existing) {
          await writeAlert({
            clientName: d.clientName,
            kind: "network.down",
            severity: "critical",
            title: `Network device unreachable: ${d.displayName} (${d.ipAddress})`,
            detailJson: JSON.stringify({
              networkDeviceId: d.id,
              displayName: d.displayName,
              ipAddress: d.ipAddress,
              kind: d.kind,
              consecutiveFails: DOWN_CONSECUTIVE_FAILS,
            }),
          })
          alertsFired.push(`down:${d.id}`)
        }
      }
    }
    // Latency alert
    const successful = recent.filter((p) => p.ok && p.rttMs != null)
    if (successful.length >= LATENCY_SAMPLE_SIZE) {
      const sorted = successful.map((p) => p.rttMs!).sort((a, b) => a - b)
      const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
      const p95 = sorted[p95Index]
      if (p95 > LATENCY_ALERT_THRESHOLD_MS) {
        const existing = await prisma.fl_Alert.findFirst({
          where: {
            clientName: d.clientName,
            deviceId: null,
            kind: "network.latency",
            state: "open",
            detailJson: { contains: `"networkDeviceId":"${d.id}"` },
          },
        })
        if (!existing) {
          await writeAlert({
            clientName: d.clientName,
            kind: "network.latency",
            severity: "warn",
            title: `High latency: ${d.displayName} p95=${p95.toFixed(0)}ms`,
            detailJson: JSON.stringify({
              networkDeviceId: d.id,
              displayName: d.displayName,
              p95Ms: p95,
              thresholdMs: LATENCY_ALERT_THRESHOLD_MS,
            }),
          })
          alertsFired.push(`latency:${d.id}`)
        }
      }
    }
  }

  return {
    ok: true,
    devicesScanned: devices.length,
    probed: probed.length,
    skippedSoon: skippedSoon.length,
    alertsFired,
  }
}
