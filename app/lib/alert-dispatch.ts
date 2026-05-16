import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { postAlertToSlack } from "@/lib/webhook-delivery"
import type { Fl_Alert } from "@prisma/client"

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

interface MatchPredicate {
  /** "critical" | "warn" | "info" | string[] | "*" */
  severity?: string | string[]
  /** Glob like "disk.*" or exact "agent.disconnected". Case-insensitive. */
  kindLike?: string
}

interface ChannelConfig {
  type: "slack" | "teams" | "email" | "sms" | "pagerduty" | "ticket"
  webhookUrl?: string
  // Other channel-specific fields elided for step 1.
  [key: string]: unknown
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
    for (const ch of channels) {
      await dispatchOneChannel(alert, ch, r.id)
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

async function dispatchOneChannel(
  alert: Fl_Alert,
  channel: ChannelConfig,
  routeId: string | null,
): Promise<void> {
  if (channel.type !== "slack") {
    // Step 1 supports Slack only; other channel types record a
    // dispatch row in skipped state so the gap is visible.
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: channel.type,
        destination: "—",
        state: "skipped-no-channel",
        escalationStep: 0,
        errorReason: "channel type not yet implemented (Workstream A step 1)",
      },
    })
    return
  }
  const url = (channel.webhookUrl ?? "").trim()
  if (!url) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "slack",
        destination: "—",
        state: "failed",
        escalationStep: 0,
        errorReason: "no webhookUrl configured",
      },
    })
    return
  }
  const fingerprint = url.slice(0, 32) + "…"
  try {
    await postAlertToSlack(url, alert)
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "slack",
        destination: fingerprint,
        state: "sent",
        escalationStep: 0,
      },
    })
  } catch (err) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "slack",
        destination: fingerprint,
        state: "failed",
        escalationStep: 0,
        errorReason: (err as Error).message.slice(0, 500),
      },
    })
  }
}

/** Public for testing + reuse from Workstream B (runbooks share the predicate). */
export function matchesAlert(predicate: MatchPredicate, alert: Fl_Alert): boolean {
  if (predicate.severity !== undefined && predicate.severity !== "*") {
    const wanted = Array.isArray(predicate.severity)
      ? predicate.severity
      : [predicate.severity]
    if (!wanted.includes(alert.severity)) return false
  }
  if (predicate.kindLike !== undefined) {
    if (!globMatch(predicate.kindLike, alert.kind)) return false
  }
  return true
}

/** Glob with `*` wildcard. Anchored full-string match, case-insensitive. */
function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    "i",
  )
  return re.test(value)
}
