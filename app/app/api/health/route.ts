import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Phase 12 WS-E.6 — health endpoint widening.
//
// Now reports cron heartbeats from Fl_EvaluatorLease. Returns 503
// when any cron in CRITICAL_CRONS hasn't heartbeated in 15 min —
// the operator's crontab probes this to catch FLEETHUB_CRON_SECRET
// drift that Phase 11 WS-E.7 left silent-detectable.

export const dynamic = "force-dynamic"

const CRITICAL_CRONS = [
  "network-probe",
  "maintenance-window-eval",
  "alert-escalator",
  "monitor-evaluator",
]

const STALE_THRESHOLD_MS = 15 * 60_000

export async function GET() {
  const now = new Date()
  let dbOk = true
  let dbErr: string | null = null
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (e) {
    dbOk = false
    dbErr = e instanceof Error ? e.message : "db unreachable"
  }
  if (!dbOk) {
    return NextResponse.json(
      {
        status: "error",
        app: "fleethub",
        error: dbErr,
        ts: now.toISOString(),
      },
      { status: 503 },
    )
  }

  // Read cron leases. Any cron in CRITICAL_CRONS that's been written
  // (heartbeatAt set) but is stale > threshold is a 503. Crons that
  // have never been written yet are tolerated (post-deploy boot).
  let leases: Array<{ name: string; heartbeatAt: Date | null }> = []
  try {
    leases = await prisma.fl_EvaluatorLease.findMany({
      select: { name: true, heartbeatAt: true },
    })
  } catch {
    // Lease table read failure is not a critical health signal;
    // surface in the body but don't 503.
  }
  const heartbeatByName = new Map(leases.map((l) => [l.name, l.heartbeatAt]))
  const staleCritical: { name: string; ageMs: number }[] = []
  for (const name of CRITICAL_CRONS) {
    const hb = heartbeatByName.get(name)
    if (!hb) continue // never-fired tolerated
    const ageMs = now.getTime() - hb.getTime()
    if (ageMs > STALE_THRESHOLD_MS) {
      staleCritical.push({ name, ageMs })
    }
  }

  const body = {
    status: staleCritical.length > 0 ? "degraded" : "ok",
    app: "fleethub",
    phase: 12,
    ts: now.toISOString(),
    crons: leases.map((l) => ({
      name: l.name,
      heartbeatAt: l.heartbeatAt?.toISOString() ?? null,
    })),
    staleCritical,
  }
  if (staleCritical.length > 0) {
    return NextResponse.json(body, { status: 503 })
  }
  return NextResponse.json(body)
}
