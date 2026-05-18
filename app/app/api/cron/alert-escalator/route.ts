import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { dispatchOneChannel, parseEscalationChain } from "@/lib/alert-dispatch"
import { withCronAuth } from "@/lib/with-cron-auth"

// Phase 7 Workstream A step 4 — escalation cron.
//
// Polls Fl_AlertDispatch rows whose ack window has expired and
// fans out the next step of the route's escalation chain. The
// chain is stored on Fl_AlertRoute.escalationJson (sorted by
// step); the per-dispatch escalationStep tells us which slot we
// just completed, so we look up chain[step+1 - 1] = chain[step]
// (step 0 primary uses route.channelsJson; chain[i] is step i+1).
//
// Cadence: every minute. Bearer-auth via FLEETHUB_AGENT_SECRET
// (same as Phase 5 report-expire + perf-rollup).
//
// Idempotent: an active escalateAt is cleared the moment the
// worker handles it, so two overlapping cron firings don't
// double-escalate the same row.

export const dynamic = "force-dynamic"
export const maxDuration = 60

const BATCH = 200

const handler = withCronAuth<NextRequest>(async (req) => {

  const now = new Date()
  const due = await prisma.fl_AlertDispatch.findMany({
    where: {
      escalateAt: { lte: now, not: null },
      // Acked dispatches don't escalate; alert-level ack clears
      // ackedAt below, but a per-dispatch ack also stops it here.
      ackedAt: null,
      alert: {
        // If the alert itself was acked or resolved, stop the chain.
        state: { notIn: ["ack", "resolved"] },
      },
    },
    orderBy: { escalateAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      alertId: true,
      escalationStep: true,
      routeId: true,
      alert: true,
    },
  })

  // Group by (alertId, current escalationStep). When the primary
  // dispatch fans out across N channels, all N rows have the same
  // (alertId, escalationStep) and we should escalate ONCE — not N
  // times. The first row in each group drives, the rest just get
  // their escalateAt cleared.
  const groups = new Map<string, typeof due[number]>()
  for (const d of due) {
    const key = `${d.alertId}:${d.escalationStep}`
    if (!groups.has(key)) groups.set(key, d)
  }

  // Phase 10 WS-B §4.4 — batch the per-lead Fl_AlertRoute.findUnique
  // and Fl_AlertDispatch.count queries that were n+1 in the loop.
  // At BATCH=200 leads that was ~400 round-trips per tick; now it's
  // ~3 (one findMany, one groupBy, plus the existing batch up top).
  const routeIds = Array.from(
    new Set(
      Array.from(groups.values())
        .map((g) => g.routeId)
        .filter((id): id is string => id != null),
    ),
  )
  const routes = await prisma.fl_AlertRoute.findMany({
    where: { id: { in: routeIds } },
    select: { id: true, escalationJson: true, isActive: true },
  })
  const routeMap = new Map(routes.map((r) => [r.id, r]))

  const alertIds = Array.from(new Set(Array.from(groups.values()).map((g) => g.alertId)))
  const stepCounts = await prisma.fl_AlertDispatch.groupBy({
    by: ["alertId", "escalationStep"],
    where: { alertId: { in: alertIds } },
    _count: true,
  })
  const stepCountMap = new Map<string, number>()
  for (const r of stepCounts) {
    stepCountMap.set(`${r.alertId}:${r.escalationStep}`, r._count)
  }

  let escalated = 0
  let exhausted = 0
  let stopped = 0
  const errors: string[] = []
  for (const lead of groups.values()) {
    try {
      const result = await escalateOne(lead, routeMap, stepCountMap)
      if (result === "escalated") escalated++
      else if (result === "exhausted") exhausted++
      else stopped++
    } catch (err) {
      errors.push(`${lead.id}: ${(err as Error).message}`)
    }
  }

  // Clear escalateAt on every dispatch we picked up so no double-
  // fire on the next tick. Done in one bulk update keyed by the
  // batch's ids.
  if (due.length > 0) {
    await prisma.fl_AlertDispatch.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { escalateAt: null },
    })
  }

  return NextResponse.json({
    sweptAt: now.toISOString(),
    examined: due.length,
    groups: groups.size,
    escalated,
    exhausted,
    stopped,
    errors,
  })
})

type EscalateOutcome = "escalated" | "exhausted" | "stopped"

async function escalateOne(
  lead: {
    id: string
    alertId: string
    escalationStep: number
    routeId: string | null
    alert: import("@prisma/client").Fl_Alert
  },
  routeMap: Map<string, { id: string; escalationJson: string | null; isActive: boolean }>,
  stepCountMap: Map<string, number>,
): Promise<EscalateOutcome> {
  // No route → chain is unrecoverable (route was deleted; we
  // detached the dispatch). Treat as exhausted.
  if (!lead.routeId) return "exhausted"
  const route = routeMap.get(lead.routeId)
  if (!route || !route.isActive) return "stopped"

  const chain = parseEscalationChain(route.escalationJson)
  // lead.escalationStep=N just completed; the next step is
  // chain[N] (chain[0] = step 1, the first escalation).
  const nextIndex = lead.escalationStep
  if (nextIndex >= chain.length) return "exhausted"

  const nextStep = chain[nextIndex]
  // Guard against the worker firing twice in overlapping windows:
  // if step nextIndex+1 already exists for this alert, skip.
  const existing = stepCountMap.get(`${lead.alertId}:${nextIndex + 1}`) ?? 0
  if (existing > 0) return "stopped"

  // Compute escalateAt for the NEXT level (chain[nextIndex+1]).
  const followOn = chain[nextIndex + 1]
  const nextEscalateAt = followOn
    ? new Date(Date.now() + followOn.afterMin * 60_000)
    : null

  for (const ch of nextStep.channels) {
    await dispatchOneChannel(lead.alert, ch, lead.routeId, nextIndex + 1, nextEscalateAt)
  }
  return "escalated"
}

export const GET = handler
export const POST = handler
