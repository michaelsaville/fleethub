import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/with-cron-auth"
import { dispatchToAgent } from "@/lib/agent-dispatch"

// Phase 9 WS-D §6.1 — close orphaned shell sessions whose
// openedAt + tenant.shellMaxDurationMin < now.
// Cadence: every 1m alongside the other Phase 7/8 watchers.

export const dynamic = "force-dynamic"

const handler = withCronAuth<NextRequest>(async () => {
  const startedAt = Date.now()
  const openSessions = await prisma.fl_ShellSession.findMany({
    where: { state: "open" },
    include: {
      device: { select: { clientName: true, agentId: true } },
    },
  })

  const tenantsByName = new Map<string, number>()
  for (const s of openSessions) {
    if (!tenantsByName.has(s.device.clientName)) {
      const t = await prisma.fl_Tenant.findUnique({
        where: { name: s.device.clientName },
        select: { shellMaxDurationMin: true },
      })
      tenantsByName.set(s.device.clientName, t?.shellMaxDurationMin ?? 60)
    }
  }

  const now = Date.now()
  let timedOut = 0
  for (const s of openSessions) {
    const maxMin = tenantsByName.get(s.device.clientName) ?? 60
    const ageMin = (now - s.openedAt.getTime()) / 60_000
    if (ageMin < maxMin) continue
    if (s.device.agentId) {
      await dispatchToAgent({
        agentId: s.device.agentId,
        method: "shell.close",
        params: { sessionId: s.id, reason: "timeout" },
      })
    }
    await prisma.fl_ShellSession.update({
      where: { id: s.id },
      data: { state: "timeout", closedAt: new Date(), exitReason: "timeout" },
    })
    timedOut += 1
  }

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - startedAt,
    examined: openSessions.length,
    timedOut,
  })
})

export const GET = handler
export const POST = handler
