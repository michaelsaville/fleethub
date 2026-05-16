import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { postAlertToSlack, postAlertToTeams } from "@/lib/webhook-delivery"
import { sendAlertEmail } from "@/lib/m365-mail"
import { sendAlertSms, redactPhone } from "@/lib/sms-twilio"
import { sendAlertToPagerDuty, redactPdKey } from "@/lib/pagerduty"
import { createAutoTicket } from "@/lib/auto-ticket"
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
  /** Slack + Teams */
  webhookUrl?: string
  /** Email */
  toEmails?: string[]
  ccEmails?: string[]
  /** SMS — array of E.164 phone numbers ("+14155551234"). */
  phoneNumbers?: string[]
  /** PagerDuty — Events API v2 integration key (lives on the channel
   *  so different clients can route to different PD services from one
   *  FleetHub install). */
  integrationKey?: string
  // Channel-specific fields for ticket land in step 7.
  [key: string]: unknown
}

interface EscalationStep {
  afterMin: number
  channels: ChannelConfig[]
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
  switch (channel.type) {
    case "slack":
      return dispatchWebhook(alert, channel, routeId, "slack", postAlertToSlack, escalationStep, escalateAt)
    case "teams":
      return dispatchWebhook(alert, channel, routeId, "teams", postAlertToTeams, escalationStep, escalateAt)
    case "email":
      return dispatchEmail(alert, channel, routeId, escalationStep, escalateAt)
    case "sms":
      return dispatchSms(alert, channel, routeId, escalationStep, escalateAt)
    case "pagerduty":
      return dispatchPagerDuty(alert, channel, routeId, escalationStep, escalateAt)
    case "ticket":
      return dispatchTicket(alert, routeId, escalationStep, escalateAt)
    default:
      // (no remaining unimplemented channel types as of step 7.)
      await prisma.fl_AlertDispatch.create({
        data: {
          alertId: alert.id,
          routeId,
          channel: channel.type,
          destination: "—",
          state: "skipped-no-channel",
          escalationStep,
          escalateAt,
          errorReason: `channel type "${channel.type}" not yet implemented (Phase 7 WS-A)`,
        },
      })
      return
  }
}

async function dispatchWebhook(
  alert: Fl_Alert,
  channel: ChannelConfig,
  routeId: string | null,
  label: "slack" | "teams",
  poster: (url: string, alert: Fl_Alert) => Promise<void>,
  escalationStep: number,
  escalateAt: Date | null,
): Promise<void> {
  const url = (channel.webhookUrl ?? "").trim()
  if (!url) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: label,
        destination: "—",
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: "no webhookUrl configured",
      },
    })
    return
  }
  const fingerprint = url.slice(0, 32) + "…"
  try {
    await poster(url, alert)
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: label,
        destination: fingerprint,
        state: "sent",
        escalationStep,
        escalateAt,
      },
    })
  } catch (err) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: label,
        destination: fingerprint,
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: (err as Error).message.slice(0, 500),
      },
    })
  }
}

async function dispatchEmail(
  alert: Fl_Alert,
  channel: ChannelConfig,
  routeId: string | null,
  escalationStep: number,
  escalateAt: Date | null,
): Promise<void> {
  const to = Array.isArray(channel.toEmails) ? channel.toEmails.filter((s) => typeof s === "string" && s.trim()) : []
  if (to.length === 0) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "email",
        destination: "—",
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: "no toEmails configured",
      },
    })
    return
  }
  const cc = Array.isArray(channel.ccEmails) ? channel.ccEmails.filter((s) => typeof s === "string" && s.trim()) : []
  // Privacy-respecting destination fingerprint: recipient count + first
  // address's domain. Never the raw addresses (audit log is searchable).
  const firstDomain = to[0].split("@")[1] ?? "—"
  const fingerprint = `${to.length} recipient${to.length === 1 ? "" : "s"} @ ${firstDomain}`
  const sev = alert.severity.toUpperCase()
  const subject = `[FleetHub ${sev}] ${alert.clientName} — ${alert.title}`
  const htmlBody = buildAlertEmailHtml(alert)
  try {
    await sendAlertEmail({ to, cc, subject, htmlBody })
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "email",
        destination: fingerprint,
        state: "sent",
        escalationStep,
        escalateAt,
      },
    })
  } catch (err) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "email",
        destination: fingerprint,
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: (err as Error).message.slice(0, 500),
      },
    })
  }
}

async function dispatchSms(
  alert: Fl_Alert,
  channel: ChannelConfig,
  routeId: string | null,
  escalationStep: number,
  escalateAt: Date | null,
): Promise<void> {
  const numbers = Array.isArray(channel.phoneNumbers)
    ? channel.phoneNumbers.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : []
  if (numbers.length === 0) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "sms",
        destination: "—",
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: "no phoneNumbers configured",
      },
    })
    return
  }
  // Privacy-respecting fingerprint: recipient count + last-4 of
  // first number. Never the raw E.164 in the audit chain.
  const fingerprint = `${numbers.length} SMS · ${redactPhone(numbers[0])}`
  try {
    await sendAlertSms(numbers, {
      id: alert.id,
      clientName: alert.clientName,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
    })
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "sms",
        destination: fingerprint,
        state: "sent",
        escalationStep,
        escalateAt,
      },
    })
  } catch (err) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "sms",
        destination: fingerprint,
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: (err as Error).message.slice(0, 500),
      },
    })
  }
}

async function dispatchPagerDuty(
  alert: Fl_Alert,
  channel: ChannelConfig,
  routeId: string | null,
  escalationStep: number,
  escalateAt: Date | null,
): Promise<void> {
  const key = typeof channel.integrationKey === "string" ? channel.integrationKey.trim() : ""
  if (!key) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "pagerduty",
        destination: "—",
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: "no integrationKey configured",
      },
    })
    return
  }
  const fingerprint = `pd ${redactPdKey(key)}`
  try {
    const { dedupKey } = await sendAlertToPagerDuty(key, {
      id: alert.id,
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
    })
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "pagerduty",
        destination: fingerprint,
        state: "sent",
        escalationStep,
        escalateAt,
        externalId: dedupKey,
      },
    })
  } catch (err) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "pagerduty",
        destination: fingerprint,
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: (err as Error).message.slice(0, 500),
      },
    })
  }
}

async function dispatchTicket(
  alert: Fl_Alert,
  routeId: string | null,
  escalationStep: number,
  escalateAt: Date | null,
): Promise<void> {
  // Ticket channel has no per-route configuration in v1; the TH
  // side decides board + priority from severity + kind. (Adding
  // a board override is a clean follow-up if operators ask.)
  // Resolve the device's hostname for context — saves the TH
  // ticket reader a cross-app round-trip.
  let hostname: string | null = null
  if (alert.deviceId) {
    const d = await prisma.fl_Device.findUnique({
      where: { id: alert.deviceId },
      select: { hostname: true },
    })
    hostname = d?.hostname ?? null
  }
  try {
    const ticket = await createAutoTicket({
      alertId: alert.id,
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      hostname,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
    })
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "ticket",
        destination: `TH #${ticket.ticketNumber}${ticket.created ? "" : " (existing)"}`,
        state: "sent",
        escalationStep,
        escalateAt,
        externalId: ticket.ticketId,
      },
    })
  } catch (err) {
    await prisma.fl_AlertDispatch.create({
      data: {
        alertId: alert.id,
        routeId,
        channel: "ticket",
        destination: "—",
        state: "failed",
        escalationStep,
        escalateAt,
        errorReason: (err as Error).message.slice(0, 500),
      },
    })
  }
}

/** Public for the escalator cron + the route-create UI. */
export function parseEscalationChain(json: string | null): EscalationStep[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    const out: EscalationStep[] = []
    for (const s of parsed) {
      if (!s || typeof s !== "object") continue
      const step = s as { afterMin?: unknown; channels?: unknown }
      const afterMin = typeof step.afterMin === "number" && step.afterMin > 0 ? step.afterMin : null
      if (afterMin == null) continue
      if (!Array.isArray(step.channels)) continue
      out.push({ afterMin, channels: step.channels as ChannelConfig[] })
    }
    return out
  } catch {
    return []
  }
}

function buildAlertEmailHtml(alert: Fl_Alert): string {
  const base = (process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com").replace(/\/$/, "")
  const sev = alert.severity.toUpperCase()
  const sevColor =
    alert.severity === "critical" ? "#B91C1C"
      : alert.severity === "warn" ? "#B45309"
      : "#0B6E99"
  const link = `${base}/alerts/${alert.id}`
  const deviceLink = alert.deviceId ? `${base}/devices/${alert.deviceId}` : null
  return `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#0F172A;font-size:14px;line-height:1.5;">
<p><span style="background:${sevColor};color:#fff;padding:2px 8px;border-radius:4px;font-weight:600;letter-spacing:0.05em;">${esc(sev)}</span>
&nbsp;<strong>${esc(alert.clientName)}</strong></p>
<p style="font-size:16px;margin:8px 0;"><strong>${esc(alert.title)}</strong></p>
<table cellpadding="0" cellspacing="0" style="font-size:13px;color:#64748B;">
<tr><td style="padding-right:16px;">Kind</td><td><code style="font-family:ui-monospace,SFMono-Regular,monospace;color:#0F172A;">${esc(alert.kind)}</code></td></tr>
<tr><td style="padding-right:16px;padding-top:4px;">Device</td><td style="padding-top:4px;">${deviceLink ? `<a href="${deviceLink}" style="color:#F97316;">view in FleetHub</a>` : "—"}</td></tr>
</table>
<p style="margin-top:20px;"><a href="${link}" style="background:${sevColor};color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600;">Open alert in FleetHub</a></p>
</body></html>`
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
