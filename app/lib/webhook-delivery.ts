import "server-only"
import { thumbnailToken } from "@/lib/pdf-thumbnail"

// Phase 5 step 8: Slack + Teams webhook delivery for scheduled reports.
//
// Design promise (PHASE-5-DESIGN §5): a thumbnail of the PDF's first page
// in the chat message turns "scheduled report nobody opens" into "report
// read in 5 seconds". The thumbnail is fetched by Slack/Teams' servers
// from /api/reports/[id]/thumbnail using the HMAC-token URL — they need
// a public URL because the chat client doesn't proxy authenticated images.
//
// Both Slack and Teams accept incoming-webhook URLs without per-message
// auth. Failures are surfaced to the caller; fireSchedule() records them
// alongside the email outcome so an operator sees per-channel state.

/** Configurable public base. Defaults to production. Override via env to
 *  point at a tunnel or staging host during smoke tests. */
function publicBaseUrl(): string {
  const raw = process.env.FLEETHUB_PUBLIC_URL?.trim()
  return (raw && raw.length > 0 ? raw : "https://fleethub.pcc2k.com").replace(/\/$/, "")
}

export function thumbnailUrl(reportId: string): string {
  return `${publicBaseUrl()}/api/reports/${reportId}/thumbnail?token=${thumbnailToken(reportId)}`
}

export function reportDeepLink(reportId: string): string {
  return `${publicBaseUrl()}/reports/${reportId}`
}

export interface WebhookContext {
  reportId: string
  kind: string
  kindLabel: string
  tenantName: string
  audience: string
  startDate: Date
  endDate: Date
}

function windowText(start: Date, end: Date): string {
  return `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`
}

export async function deliverToSlack(
  webhookUrl: string,
  ctx: WebhookContext,
): Promise<void> {
  const window = windowText(ctx.startDate, ctx.endDate)
  const link = reportDeepLink(ctx.reportId)
  const thumb = thumbnailUrl(ctx.reportId)

  const payload = {
    text: `${ctx.kindLabel} — ${ctx.tenantName} — ${window}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${ctx.kindLabel} — ${ctx.tenantName}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Period*\n${window}` },
          { type: "mrkdwn", text: `*Audience*\n${ctx.audience}` },
        ],
      },
      {
        type: "image",
        image_url: thumb,
        alt_text: `${ctx.kindLabel} cover preview`,
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open in FleetHub" },
            url: link,
            style: "primary",
          },
        ],
      },
    ],
  }

  await postWebhook("slack", webhookUrl, payload)
}

export async function deliverToTeams(
  webhookUrl: string,
  ctx: WebhookContext,
): Promise<void> {
  const window = windowText(ctx.startDate, ctx.endDate)
  const link = reportDeepLink(ctx.reportId)
  const thumb = thumbnailUrl(ctx.reportId)

  // MessageCard schema (legacy connector format) — still the most reliably
  // rendered shape across Teams desktop, web, and mobile clients today.
  const payload = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    summary: `${ctx.kindLabel} report — ${ctx.tenantName}`,
    themeColor: "0B6E99",
    title: `${ctx.kindLabel} — ${ctx.tenantName}`,
    sections: [
      {
        activityTitle: `Period: ${window}`,
        activitySubtitle: `Audience: ${ctx.audience}`,
        images: [{ image: thumb, title: `${ctx.kindLabel} cover preview` }],
      },
    ],
    potentialAction: [
      {
        "@type": "OpenUri",
        name: "Open in FleetHub",
        targets: [{ os: "default", uri: link }],
      },
    ],
  }

  await postWebhook("teams", webhookUrl, payload)
}

async function postWebhook(
  channel: "slack" | "teams",
  webhookUrl: string,
  body: unknown,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${channel} webhook fetch failed: ${msg}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(
      `${channel} webhook returned ${res.status}${text ? ": " + text.slice(0, 200) : ""}`,
    )
  }
}

// Cheap URL validator used by the schedule API. Catches typos at create
// time so they don't surface as "deliver failed" later.
export function isValidWebhookUrl(s: string, channel: "slack" | "teams"): boolean {
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return false
  }
  if (u.protocol !== "https:") return false
  if (channel === "slack") {
    return /\.slack\.com$/.test(u.hostname) || u.hostname === "hooks.slack.com"
  }
  // Teams Incoming Webhooks live under *.webhook.office.com.
  return /\.webhook\.office\.com$/.test(u.hostname) || u.hostname.endsWith("logic.azure.com")
}

// ─── Phase 7 Workstream A — alert dispatch ───────────────────────────────

const SEVERITY_EMOJI = { critical: "🔴", warn: "🟠", info: "🔵" } as const

interface AlertForDelivery {
  id: string
  clientName: string
  deviceId: string | null
  kind: string
  severity: string
  title: string
  detailJson: string | null
}

/**
 * POST an alert-shaped Block Kit message to a Slack incoming
 * webhook. Distinct from `deliverToSlack` (which renders the
 * report-shaped message with thumbnail) — alerts and reports
 * share the transport but the content differs.
 */
export async function postAlertToSlack(
  webhookUrl: string,
  alert: AlertForDelivery,
): Promise<void> {
  const sev = (SEVERITY_EMOJI as Record<string, string>)[alert.severity] ?? "⚠"
  const link = `${publicBaseUrl()}/alerts/${alert.id}`
  const deviceLine = alert.deviceId
    ? `${publicBaseUrl()}/devices/${alert.deviceId}`
    : null

  const payload = {
    text: `${sev} ${alert.severity.toUpperCase()} · ${alert.clientName} · ${alert.title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${sev} ${alert.severity.toUpperCase()} — ${alert.clientName}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${alert.title}*` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Kind*\n\`${alert.kind}\`` },
          { type: "mrkdwn", text: `*Device*\n${deviceLine ? `<${deviceLine}|view>` : "—"}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open in FleetHub" },
            url: link,
            style: alert.severity === "critical" ? "danger" : "primary",
          },
        ],
      },
    ],
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`slack webhook returned ${res.status}: ${await res.text().catch(() => "")}`)
  }
}

const SEVERITY_THEME = { critical: "B91C1C", warn: "B45309", info: "0B6E99" } as const

/**
 * POST an alert-shaped MessageCard to a Teams incoming webhook.
 * Same transport as `deliverToTeams` (report flavor); content
 * mirrors the Slack alert layout.
 */
export async function postAlertToTeams(
  webhookUrl: string,
  alert: AlertForDelivery,
): Promise<void> {
  const sev = (SEVERITY_EMOJI as Record<string, string>)[alert.severity] ?? "⚠"
  const theme = (SEVERITY_THEME as Record<string, string>)[alert.severity] ?? "555555"
  const link = `${publicBaseUrl()}/alerts/${alert.id}`
  const deviceLink = alert.deviceId
    ? `${publicBaseUrl()}/devices/${alert.deviceId}`
    : null

  const payload = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    summary: `${alert.severity.toUpperCase()} alert — ${alert.clientName}`,
    themeColor: theme,
    title: `${sev} ${alert.severity.toUpperCase()} — ${alert.clientName}`,
    sections: [
      {
        activityTitle: alert.title,
        facts: [
          { name: "Kind", value: alert.kind },
          { name: "Device", value: deviceLink ? `[view](${deviceLink})` : "—" },
        ],
        markdown: true,
      },
    ],
    potentialAction: [
      {
        "@type": "OpenUri",
        name: "Open in FleetHub",
        targets: [{ os: "default", uri: link }],
      },
    ],
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`teams webhook returned ${res.status}: ${await res.text().catch(() => "")}`)
  }
}
