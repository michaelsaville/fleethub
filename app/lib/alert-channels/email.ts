import "server-only"
import { sendAlertEmail } from "@/lib/m365-mail"
import { resolveCurrentOncall } from "@/lib/oncall"
import { ackUrl } from "@/lib/alert-ack-token"
import type { Fl_Alert } from "@prisma/client"
import type { AlertChannelAdapter } from "./types"

// Phase 8 Workstream C §5.2 — Email adapter. Preflight needs DB
// access for the on-call resolution, so it doesn't fit the
// synchronous preflight contract — destination resolution lives
// inside send() and throws on miss (the dispatcher records "failed"
// with the thrown message, which is the same outcome the pre-
// refactor code wrote with a preflight string).

export const emailAdapter: AlertChannelAdapter = {
  type: "email",
  async send(alert, config) {
    let to: string[] = []
    let oncallSuffix = ""

    if (typeof config.oncallScheduleId === "string" && config.oncallScheduleId.trim()) {
      const resolved = await resolveCurrentOncall(config.oncallScheduleId.trim())
      if (!resolved) {
        throw new Error("on-call resolver returned no user (inactive schedule / unscheduled time / inactive user)")
      }
      to = [resolved.user.email]
      oncallSuffix = ` (on-call${resolved.fromOverride ? " override" : ""})`
    } else {
      to = Array.isArray(config.toEmails)
        ? config.toEmails.filter((s) => typeof s === "string" && s.trim() !== "")
        : []
    }
    if (to.length === 0) {
      throw new Error("no toEmails configured")
    }
    const cc = Array.isArray(config.ccEmails)
      ? config.ccEmails.filter((s) => typeof s === "string" && s.trim() !== "")
      : []

    // Privacy-respecting fingerprint: recipient count + first
    // address's domain. Never the raw addresses (audit log is
    // searchable). Format matches the pre-refactor output.
    const firstDomain = to[0].split("@")[1] ?? "—"
    const destination = `${to.length} recipient${to.length === 1 ? "" : "s"} @ ${firstDomain}${oncallSuffix}`

    const sev = alert.severity.toUpperCase()
    const subject = `[FleetHub ${sev}] ${alert.clientName} — ${alert.title}`
    const htmlBody = buildAlertEmailHtml(alert)
    await sendAlertEmail({ to, cc, subject, htmlBody })
    return { destination }
  },
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
  const ack = ackUrl(alert.id)
  return `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#0F172A;font-size:14px;line-height:1.5;">
<p><span style="background:${sevColor};color:#fff;padding:2px 8px;border-radius:4px;font-weight:600;letter-spacing:0.05em;">${esc(sev)}</span>
&nbsp;<strong>${esc(alert.clientName)}</strong></p>
<p style="font-size:16px;margin:8px 0;"><strong>${esc(alert.title)}</strong></p>
<table cellpadding="0" cellspacing="0" style="font-size:13px;color:#64748B;">
<tr><td style="padding-right:16px;">Kind</td><td><code style="font-family:ui-monospace,SFMono-Regular,monospace;color:#0F172A;">${esc(alert.kind)}</code></td></tr>
<tr><td style="padding-right:16px;padding-top:4px;">Device</td><td style="padding-top:4px;">${deviceLink ? `<a href="${deviceLink}" style="color:#F97316;">view in FleetHub</a>` : "—"}</td></tr>
</table>
<p style="margin-top:20px;">
<a href="${ack}" style="background:#15803D;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600;margin-right:8px;">Ack alert</a>
<a href="${link}" style="background:${sevColor};color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600;">Open in FleetHub</a>
</p>
<p style="font-size:11px;color:#94A3B8;margin-top:24px;">Clicking <em>Ack</em> stops the escalation chain. Anyone with this email can ack.</p>
</body></html>`
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
