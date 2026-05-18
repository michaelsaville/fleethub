import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/with-cron-auth"

// Phase 12 WS-A.3 — Fl_NetworkProbe retention sweep.
//
// Ships BEFORE the probe cron lands populated per PHASE-12-DESIGN.md
// §3 footgun 2. With ICMP at 60s × 50 devices × 30d = 2.16M
// rows/tenant/month, month-3 is when an unguarded fact-table becomes
// "we noticed when ops asked". 90d retention is the design default;
// rollup (Fl_NetworkProbeHour) carries longer-horizon trend data.
//
// Cadence: daily (operator crontab entry). Bearer-auth via
// FLEETHUB_CRON_SECRET (Phase 11 WS-E.7 hardened — no fallback).

export const dynamic = "force-dynamic"

const RETENTION_DAYS = 90

export const POST = withCronAuth(async (_req: NextRequest) => {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
  const result = await prisma.fl_NetworkProbe.deleteMany({
    where: { ts: { lt: cutoff } },
  })
  return NextResponse.json({
    ok: true,
    deletedCount: result.count,
    cutoff: cutoff.toISOString(),
  })
})
