import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Cron-style sweep: any Fl_Device that's been "online" but hasn't
 * heartbeated within STALE_THRESHOLD_SEC seconds gets marked offline
 * and produces one `agent.disconnected` alert (deduplicated — we
 * don't fire a fresh alert if the previous disconnect alert is still
 * open for the same device).
 *
 * Per docs/AGENT-PROTOCOL.md §5.3, the default heartbeatSec is 30 and
 * three missed heartbeats fire `agent.disconnected`. Threshold = 90s.
 *
 * Auth: Bearer FLEETHUB_AGENT_SECRET (same secret as /api/agent-ingest;
 * a single-purpose cron token isn't justified at Phase 1 scale).
 *
 * Driver: host crontab or systemd timer hitting this route every
 * minute. Sample crontab entry:
 *
 *   * * * * * curl -fsS -H "Authorization: Bearer $FLEETHUB_AGENT_SECRET" \
 *     https://fleethub.pcc2k.com/api/cron/stale-agents > /dev/null
 */

const STALE_THRESHOLD_SEC = 90

export async function POST(req: Request) {
  return run(req)
}
export async function GET(req: Request) {
  return run(req)
}

async function run(req: Request) {
  const secret = process.env.FLEETHUB_AGENT_SECRET
  if (!secret) {
    return NextResponse.json({ error: "cron-not-configured" }, { status: 503 })
  }
  const auth = req.headers.get("authorization") ?? ""
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - STALE_THRESHOLD_SEC * 1000)
  const stale = await prisma.fl_Device.findMany({
    where: {
      isActive: true,
      isOnline: true,
      OR: [
        { lastSeenAt: { lt: cutoff } },
        { lastSeenAt: null },
      ],
    },
    select: { id: true, clientName: true, hostname: true, lastSeenAt: true },
  })

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, marked: 0, alerted: 0 })
  }

  await prisma.fl_Device.updateMany({
    where: { id: { in: stale.map((d) => d.id) } },
    data: { isOnline: false },
  })

  let alerted = 0
  for (const d of stale) {
    const open = await prisma.fl_Alert.findFirst({
      where: {
        deviceId: d.id,
        kind: "agent.disconnected",
        state: "open",
      },
      select: { id: true },
    })
    if (open) continue
    const lastSeenStr = d.lastSeenAt
      ? `${Math.round((Date.now() - d.lastSeenAt.getTime()) / 1000)}s ago`
      : "never"
    await prisma.fl_Alert.create({
      data: {
        clientName: d.clientName,
        deviceId: d.id,
        kind: "agent.disconnected",
        severity: "warn",
        title: `Agent offline (last heartbeat ${lastSeenStr})`,
        detailJson: JSON.stringify({ thresholdSec: STALE_THRESHOLD_SEC }),
        state: "open",
      },
    })
    await writeAudit({
      deviceId: d.id,
      clientName: d.clientName,
      action: "agent.disconnected",
      outcome: "error",
      detail: { hostname: d.hostname, lastSeenAt: d.lastSeenAt?.toISOString() ?? null },
    })
    alerted++
  }

  return NextResponse.json({ ok: true, marked: stale.length, alerted })
}
