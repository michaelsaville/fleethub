import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { ALERT_CHANNEL_ADAPTERS } from "@/lib/alert-channels"
import {
  matchesAlert,
  parseEscalationChain,
  type MatchPredicate,
  type ChannelConfig,
  type EscalationStep,
} from "@/lib/alert-match"
import type { Fl_Alert } from "@prisma/client"

// Re-export so existing callers that import these from
// "@/lib/alert-dispatch" keep working.
export { matchesAlert, parseEscalationChain }
export type { MatchPredicate, ChannelConfig, EscalationStep }

// Phase 7 Workstream A step 1 — match-route-and-dispatch core.
// Synchronous in v1 per design §3.2: the alert writer awaits
// dispatch so critical alerts can't sit in a "we'll get to it"
// queue. v1.5 will queue once measured load justifies it.
//
// Only the Slack channel is implemented in step 1. Step 2 adds
// Teams + email; step 3 adds the routing UI. Default-fallback
// route is hardcoded here so step 1 is shippable on its own.

export interface AlertInput {
  clientName: string
  deviceId?: string | null
  kind: string
  severity: "info" | "warn" | "critical"
  title: string
  detailJson?: string | null
}

/**
 * Create an Fl_Alert AND dispatch it. The single helper every
 * alert-writing path should go through; existing prisma.fl_Alert
 * .create call sites are migrated to this in step 1.
 */
export async function writeAlert(input: AlertInput): Promise<Fl_Alert> {
  const alert = await prisma.fl_Alert.create({
    data: {
      clientName: input.clientName,
      deviceId: input.deviceId ?? null,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      detailJson: input.detailJson ?? null,
      state: "open",
    },
  })

  try {
    await dispatchAlert(alert)
  } catch (err) {
    // Dispatch failure must NOT break alert creation — the alert
    // itself is the durable record. Log + audit so an operator can
    // investigate without losing the alert.
    console.warn(`[alert-dispatch] failed for ${alert.id}:`, err)
    await writeAudit({
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      action: "alert.dispatch.error",
      outcome: "error",
      detail: { alertId: alert.id, error: (err as Error).message },
    }).catch(() => undefined)
  }

  // Phase 7 Workstream B — runbook evaluator runs AFTER dispatch.
  // Same isolation contract as the dispatch path: failures here
  // never break alert creation.
  try {
    // Import inside the try so a build-time circular-dep doesn't
    // wedge writeAlert; the evaluator imports matchesAlert from
    // this file.
    const { evaluateRunbooksForAlert } = await import("@/lib/runbook-evaluator")
    await evaluateRunbooksForAlert(alert)
  } catch (err) {
    console.warn(`[runbook-evaluator] failed for ${alert.id}:`, err)
    await writeAudit({
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      action: "runbook.evaluator.error",
      outcome: "error",
      detail: { alertId: alert.id, error: (err as Error).message },
    }).catch(() => undefined)
  }

  return alert
}

/**
 * Pick the first matching Fl_AlertRoute and dispatch via each of
 * its channels. Falls back to a hardcoded default Slack webhook
 * (FLEETHUB_DEFAULT_ALERT_WEBHOOK_URL) when nothing matches; if
 * that's unset too, the alert is silently un-routed (an
 * Fl_AlertDispatch row is still written with state="skipped-no-
 * channel" so an operator can see the gap).
 */
export async function dispatchAlert(alert: Fl_Alert): Promise<void> {
  // Pull active routes ordered by priority (asc). Tenant-specific
  // wins over null tenant (default fallback rules at the bottom of
  // the priority list).
  const routes = await prisma.fl_AlertRoute.findMany({
    where: {
      isActive: true,
      OR: [{ tenantName: alert.clientName }, { tenantName: null }],
    },
    orderBy: [
      // Tenant-specific routes first within the same priority.
      { tenantName: "desc" },
      { priority: "asc" },
      { createdAt: "asc" },
    ],
  })

  for (const r of routes) {
    let predicate: MatchPredicate
    try {
      predicate = JSON.parse(r.matchJson) as MatchPredicate
    } catch {
      continue
    }
    if (!matchesAlert(predicate, alert)) continue

    // Dedup: was there a recent dispatch for this (alert.kind,
    // alert.deviceId) under this route? If so, suppress.
    if (r.dedupWindowMin > 0) {
      const since = new Date(Date.now() - r.dedupWindowMin * 60_000)
      const recent = await prisma.fl_AlertDispatch.findFirst({
        where: {
          routeId: r.id,
          createdAt: { gte: since },
          alert: {
            kind: alert.kind,
            deviceId: alert.deviceId,
          },
        },
        select: { id: true },
      })
      if (recent) {
        await prisma.fl_AlertDispatch.create({
          data: {
            alertId: alert.id,
            routeId: r.id,
            channel: "—",
            destination: "—",
            state: "skipped-deduped",
            escalationStep: 0,
          },
        })
        return
      }
    }

    let channels: ChannelConfig[]
    try {
      channels = JSON.parse(r.channelsJson) as ChannelConfig[]
    } catch {
      continue
    }
    // Compute escalateAt for the primary dispatch: now + the first
    // chain step's afterMin. Cron picks it up when the ack window
    // expires (state="sent"/"failed" + escalateAt <= now + alert
    // not acked/resolved). Null when the route has no chain.
    const chain = parseEscalationChain(r.escalationJson)
    const escalateAt = chain.length > 0
      ? new Date(Date.now() + chain[0].afterMin * 60_000)
      : null
    for (const ch of channels) {
      await dispatchOneChannel(alert, ch, r.id, 0, escalateAt)
    }
    return
  }

  // No route matched — fall back to the hardcoded default.
  const fallback = (process.env.FLEETHUB_DEFAULT_ALERT_WEBHOOK_URL ?? "").trim()
  if (!fallback) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        channel: "—",
        destination: "—",
        state: "skipped-no-channel",
        escalationStep: 0,
      },
    })
    return
  }
  await dispatchOneChannel(alert, { type: "slack", webhookUrl: fallback }, null)
}

/**
 * Public so the escalator cron can call directly with its own
 * escalationStep + escalateAt computed from chain[step].
 */
export async function dispatchOneChannel(
  alert: Fl_Alert,
  channel: ChannelConfig,
  routeId: string | null,
  escalationStep = 0,
  escalateAt: Date | null = null,
): Promise<void> {
  // Phase 8 Workstream C §5.2 — registry-driven. The six per-channel
  // functions that used to live in this file now live in
  // lib/alert-channels/*.ts; the contract is preflight → send →
  // throw-on-failure. Adding a new channel is one new file plus
  // one entry in the registry.
  const adapter = ALERT_CHANNEL_ADAPTERS[channel.type]
  if (!adapter) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: channel.type,
        destination: "—",
        state: "skipped-no-channel",
        escalationStep,
        escalateAt,
        errorReason: `channel type "${channel.type}" has no adapter registered`,
      },
    })
    return
  }

  // Synchronous preflight — for adapters that can short-circuit
  // without a network/DB round-trip (Slack/Teams/PagerDuty
  // missing-config cases).
  if (adapter.preflight) {
    const reason = adapter.preflight(channel)
    if (reason) {
      await prisma.fl_AlertDispatch.create({
        data: {
          alertId: alert.id,
          routeId,
          channel: channel.type,
          destination: "—",
          state: "failed",
          escalationStep,
          escalateAt,
          errorReason: reason,
        },
      })
      return
    }
  }

  try {
    const result = await adapter.send(alert, channel)
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: channel.type,
        destination: result.destination,
        state: "sent",
        escalationStep,
        escalateAt,
        externalId: result.externalId,
      },
    })
  } catch (err) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: channel.type,
        destination: "—",
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: (err as Error).message.slice(0, 500),
      },
    })
  }
}


/**
 * Mark an alert acked + cascade to its open dispatches. Used by
 * the in-app server action and the signed-link ack URL — single
 * source of truth for "what happens on ack" so the two paths
 * can't drift.
 *
 * Idempotent: re-acking an already-acked alert is a no-op (the
 * cascade still runs in case dispatches were missed by an earlier
 * call against an older alert-dispatcher version).
 */
export async function markAlertAcked(alertId: string, actor: string): Promise<{
  alreadyAcked: boolean
}> {
  const alert = await prisma.fl_Alert.findUnique({
    where: { id: alertId },
    select: { id: true, state: true, clientName: true, deviceId: true, kind: true, severity: true },
  })
  if (!alert) throw new Error(`alert ${alertId} not found`)

  const alreadyAcked = alert.state !== "open"
  const now = new Date()
  if (!alreadyAcked) {
    await writeAudit({
      actorEmail: actor,
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      action: "alert.ack",
      outcome: "ok",
      detail: { alertId, kind: alert.kind, severity: alert.severity },
    })
    await prisma.fl_Alert.update({
      where: { id: alertId },
      data: { state: "ack", ackedBy: actor, ackedAt: now },
    })
  }

  // Cascade: any dispatch row still waiting to escalate gets
  // ackedAt + state=acked + escalateAt cleared so the cron stops
  // chasing it. Run even for already-acked alerts so legacy rows
  // get repaired.
  await prisma.fl_AlertDispatch.updateMany({
    where: {
      alertId,
      OR: [{ ackedAt: null }, { escalateAt: { not: null } }],
    },
    data: { ackedAt: now, ackedBy: actor, state: "acked", escalateAt: null },
  })

  return { alreadyAcked }
}

/**
 * Force-fire the next escalation step on demand (Cmd-K
 * `escalate <id>` or a "Force escalate" button). Finds the
 * latest dispatch step for the alert and runs the same
 * escalateOne logic the cron would have run at escalateAt.
 *
 * Returns the new step number if escalation fired, null when
 * there's no next step (chain exhausted or no route).
 */
export async function forceEscalate(alertId: string): Promise<{
  status: "escalated" | "exhausted" | "no-dispatch" | "stopped"
  toStep?: number
}> {
  // Latest dispatch row for this alert by escalationStep DESC.
  const last = await prisma.fl_AlertDispatch.findFirst({
    where: { alertId },
    orderBy: [{ escalationStep: "desc" }, { createdAt: "desc" }],
    select: { id: true, escalationStep: true, routeId: true },
  })
  if (!last) return { status: "no-dispatch" }
  if (!last.routeId) return { status: "exhausted" }
  const route = await prisma.fl_AlertRoute.findUnique({
    where: { id: last.routeId },
    select: { escalationJson: true, isActive: true },
  })
  if (!route || !route.isActive) return { status: "stopped" }
  const chain = parseEscalationChain(route.escalationJson)
  const nextIndex = last.escalationStep
  if (nextIndex >= chain.length) return { status: "exhausted" }
  const alert = await prisma.fl_Alert.findUnique({ where: { id: alertId } })
  if (!alert) return { status: "no-dispatch" }
  if (alert.state === "ack" || alert.state === "resolved") return { status: "stopped" }
  const followOn = chain[nextIndex + 1]
  const nextEscalateAt = followOn ? new Date(Date.now() + followOn.afterMin * 60_000) : null
  for (const ch of chain[nextIndex].channels) {
    await dispatchOneChannel(alert, ch, last.routeId, nextIndex + 1, nextEscalateAt)
  }
  // Clear any pending escalateAt on the previous step so cron
  // doesn't double-fire.
  await prisma.fl_AlertDispatch.updateMany({
    where: { alertId, escalationStep: last.escalationStep },
    data: { escalateAt: null },
  })
  return { status: "escalated", toStep: nextIndex + 1 }
}

// matchesAlert + parseEscalationChain + globMatch moved to
// lib/alert-match.ts (Phase 8 WS-C §5.5) so vitest can import them
// without dragging in the prisma module. Re-exported at the top of
// this file for backward compat.
