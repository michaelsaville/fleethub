import type { Mapper, MapperContext } from "./types"
import { IgnoredEvent } from "./types"

// UptimeRobot's webhook payload shape (legacy + v2 generic).
// They support URL-templated values via {monitorURL} / {alertType} /
// {alertDetails} etc., but the most reliable shape is the
// post-JSON config where the operator pastes:
//
//   {
//     "monitorURL":   "{monitorURL}",
//     "monitorFriendlyName": "{monitorFriendlyName}",
//     "alertType":    "{alertType}",
//     "alertTypeFriendlyName": "{alertTypeFriendlyName}",
//     "alertDetails": "{alertDetails}",
//     "alertDuration": "{alertDuration}",
//     "monitorAlertContacts": "{monitorAlertContacts}"
//   }
//
// alertType values: 1=down, 2=up, 3=paused, 4=started.
//
// Mapping rules:
//   - alertType=1 (down): warn severity by default, critical when
//     alertDuration > 600s. severityCritOverSec configurable.
//   - alertType=2 (up): IgnoredEvent — we don't fire a "recovery"
//     alert. The original Fl_Alert remains open until acked.
//     UptimeRobot still gets a 200 + a fire entry.
//   - alertType=3 (paused) / 4 (started): IgnoredEvent.

interface UptimeRobotPayload {
  monitorURL?: string
  monitorFriendlyName?: string
  alertType?: string | number
  alertTypeFriendlyName?: string
  alertDetails?: string
  alertDuration?: string | number
  monitorAlertContacts?: string
}

interface Config {
  /// Override severity for any down event. Default "warn".
  defaultSeverity?: "critical" | "warn" | "info"
  /// Promote a down event to critical when alertDuration >= this many
  /// seconds. Default 600 (10 minutes).
  severityCritOverSec?: number
  /// Kind prefix. Default "inbound.uptimerobot".
  kindPrefix?: string
}

export const uptimeRobotMapper: Mapper = async (ctx: MapperContext) => {
  const p = ctx.parsedBody as UptimeRobotPayload | null
  if (!p || typeof p !== "object") {
    throw new Error("UptimeRobot payload must be a JSON object")
  }
  const monitorName = String(p.monitorFriendlyName ?? p.monitorURL ?? "(unnamed monitor)").trim()
  const alertTypeRaw = p.alertType
  const alertType = typeof alertTypeRaw === "number" ? alertTypeRaw : parseInt(String(alertTypeRaw ?? ""), 10)
  if (!Number.isFinite(alertType)) {
    throw new Error(`alertType is missing or not numeric (got ${JSON.stringify(alertTypeRaw)})`)
  }

  // Ignore everything except "down" — recovery / paused / started
  // don't need to fire a new alert. UptimeRobot retries on non-2xx,
  // so we want a clean 200 + a fire record + IgnoredEvent.
  if (alertType !== 1) {
    const labels: Record<number, string> = { 2: "up", 3: "paused", 4: "started" }
    throw new IgnoredEvent(`alertType=${alertType} (${labels[alertType] ?? "non-down"}) — ignored`)
  }

  const config = (ctx.config ?? {}) as Config
  const prefix = (config.kindPrefix ?? "inbound.uptimerobot").trim() || "inbound.uptimerobot"
  const defaultSeverity = config.defaultSeverity === "critical" || config.defaultSeverity === "info"
    ? config.defaultSeverity
    : "warn"
  const critOverSec = typeof config.severityCritOverSec === "number" && config.severityCritOverSec > 0
    ? config.severityCritOverSec
    : 600

  const durationSec = typeof p.alertDuration === "number"
    ? p.alertDuration
    : parseInt(String(p.alertDuration ?? "0"), 10)
  const severity: "critical" | "warn" | "info" =
    Number.isFinite(durationSec) && durationSec >= critOverSec
      ? "critical"
      : defaultSeverity

  const title = `${monitorName} is down${
    p.alertDetails ? ` — ${truncate(String(p.alertDetails), 120)}` : ""
  }`
  const detail = {
    monitorName,
    monitorURL: p.monitorURL ?? null,
    alertType,
    alertTypeFriendlyName: p.alertTypeFriendlyName ?? null,
    alertDetails: p.alertDetails ?? null,
    alertDurationSec: Number.isFinite(durationSec) ? durationSec : null,
    monitorAlertContacts: p.monitorAlertContacts ?? null,
  }

  return {
    clientName: ctx.tenantName,
    kind: `${prefix}.${slugify(monitorName)}.down`,
    severity,
    title,
    detailJson: JSON.stringify(detail),
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "monitor"
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}
