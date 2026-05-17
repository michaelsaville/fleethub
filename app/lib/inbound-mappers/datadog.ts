import type { Mapper, MapperContext } from "./types"
import { IgnoredEvent } from "./types"

// Datadog webhook payload. Datadog's @webhook-* integration posts
// a JSON body the operator templates in the Webhooks integration
// page. The most reliable template — the one we document for our
// operators — is:
//
//   {
//     "alert_type":   "$ALERT_TYPE",       // "error" | "warning" | "success" | "info" | "no_data"
//     "alert_status": "$ALERT_STATUS",     // "triggered" | "recovered"
//     "title":        "$EVENT_TITLE",
//     "message":      "$EVENT_MSG",
//     "hostname":     "$HOSTNAME",
//     "tags":         "$TAGS",
//     "priority":     "$PRIORITY",         // "normal" | "low"
//     "link":         "$LINK"
//   }
//
// Recovery events (alert_status=recovered) → IgnoredEvent so the
// existing Fl_Alert stays open until acked.

interface DatadogPayload {
  alert_type?: string
  alert_status?: string
  title?: string
  message?: string
  hostname?: string
  tags?: string
  priority?: string
  link?: string
  // We also accept these older / alternative field names — Datadog
  // operators sometimes paste templates with $EVENT_TYPE / $EVENT_TITLE
  // already filled in.
  event_type?: string
  event_title?: string
}

interface Config {
  /// Kind prefix. Default "inbound.datadog".
  kindPrefix?: string
  /// Override severity for any error alert_type. Default "critical".
  errorSeverity?: "critical" | "warn" | "info"
  /// Override severity for warning alert_type. Default "warn".
  warningSeverity?: "critical" | "warn" | "info"
}

const SEVERITY_MAP: Record<string, "critical" | "warn" | "info"> = {
  error: "critical",
  warning: "warn",
  info: "info",
  success: "info",
  no_data: "warn",
}

export const datadogMapper: Mapper = async (ctx: MapperContext) => {
  const p = ctx.parsedBody as DatadogPayload | null
  if (!p || typeof p !== "object") {
    throw new Error("Datadog payload must be a JSON object")
  }
  const config = (ctx.config ?? {}) as Config

  // Recovery → ignored. Datadog also sends "ok" on monitor resolves
  // in some configurations; both treated the same.
  const status = String(p.alert_status ?? "").toLowerCase()
  if (status === "recovered" || status === "ok") {
    throw new IgnoredEvent(`alert_status=${status} — recovery, no alert raised`)
  }

  const alertType = String(p.alert_type ?? p.event_type ?? "").toLowerCase()
  const baseSeverity = SEVERITY_MAP[alertType] ?? "warn"
  const severity =
    baseSeverity === "critical"
      ? (config.errorSeverity ?? "critical")
      : baseSeverity === "warn"
        ? (config.warningSeverity ?? "warn")
        : baseSeverity

  const title = (p.title ?? p.event_title ?? p.message ?? "").trim() || "Datadog event"
  const prefix = (config.kindPrefix ?? "inbound.datadog").trim() || "inbound.datadog"
  // Use alert_type so the operator can route on "datadog.error" vs
  // "datadog.warning" rules.
  const kindSuffix = alertType || "event"
  const kind = `${prefix}.${kindSuffix}`

  return {
    clientName: ctx.tenantName,
    kind,
    severity,
    title: title.length > 200 ? title.slice(0, 197) + "…" : title,
    detailJson: JSON.stringify({
      alertType: alertType || null,
      alertStatus: status || null,
      message: p.message ?? null,
      hostname: p.hostname ?? null,
      tags: p.tags ?? null,
      priority: p.priority ?? null,
      link: p.link ?? null,
    }),
  }
}
