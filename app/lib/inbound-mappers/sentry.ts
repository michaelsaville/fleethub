import { createHmac, timingSafeEqual } from "node:crypto"
import type { Mapper, MapperContext } from "./types"
import { IgnoredEvent } from "./types"

// Sentry "Internal Integration" webhooks sign their requests with
// HMAC-SHA256 over the raw body bytes using the integration's
// `clientSecret`. Header is `sentry-hook-signature` (hex). When the
// secret is configured on this row, we verify; otherwise we skip
// the check (gives the operator a path to smoke without juggling
// secrets first).
//
// Reference: https://docs.sentry.io/product/integrations/integration-platform/webhooks/#verifying-the-signature
//
// Payload shape (issue.created / issue.resolved / etc.):
//   {
//     "action":   "created" | "resolved" | "assigned" | "ignored",
//     "actor":    { ... },
//     "data": {
//       "issue": {
//         "id":       "...",
//         "level":    "error" | "warning" | "info" | "fatal",
//         "title":    "...",
//         "shortId":  "PROJ-1234",
//         "permalink":"https://sentry.io/...",
//         "project":  { "slug": "..." }
//       }
//     }
//   }
//
// We fire on "created" only — resolved/assigned/ignored are
// IgnoredEvents.

interface SentryPayload {
  action?: string
  data?: {
    issue?: {
      id?: string
      level?: string
      title?: string
      shortId?: string
      permalink?: string
      project?: { slug?: string }
    }
  }
}

interface Config {
  /// Sentry integration clientSecret. When set, requests must carry
  /// a valid `sentry-hook-signature` header.
  hmacSecret?: string
  /// Kind prefix. Default "inbound.sentry".
  kindPrefix?: string
  /// Promote fatal to critical (default true). Sentry's "level"
  /// otherwise maps: fatal→critical, error→critical, warning→warn,
  /// info→info.
  fatalAsCritical?: boolean
}

const LEVEL_MAP: Record<string, "critical" | "warn" | "info"> = {
  fatal: "critical",
  error: "critical",
  warning: "warn",
  info: "info",
  debug: "info",
}

export const sentryMapper: Mapper = async (ctx: MapperContext) => {
  const config = (ctx.config ?? {}) as Config

  // HMAC verification — only when a secret is configured. The
  // header is hex; SHA-256 over rawBody bytes with the secret.
  if (typeof config.hmacSecret === "string" && config.hmacSecret.length > 0) {
    const provided = ctx.headers["sentry-hook-signature"] ?? ""
    if (!provided) {
      throw new Error("missing sentry-hook-signature header")
    }
    const expected = createHmac("sha256", config.hmacSecret).update(ctx.rawBody).digest("hex")
    let expectedBuf: Buffer, providedBuf: Buffer
    try {
      expectedBuf = Buffer.from(expected, "hex")
      providedBuf = Buffer.from(provided, "hex")
    } catch {
      throw new Error("sentry-hook-signature is not valid hex")
    }
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new Error("sentry-hook-signature mismatch")
    }
  }

  const p = ctx.parsedBody as SentryPayload | null
  if (!p || typeof p !== "object") {
    throw new Error("Sentry payload must be a JSON object")
  }
  const action = String(p.action ?? "").toLowerCase()
  if (action !== "created") {
    throw new IgnoredEvent(`action=${action || "(missing)"} — only "created" raises an alert`)
  }
  const issue = p.data?.issue
  if (!issue) {
    throw new Error("data.issue is missing — Sentry payload doesn't match the expected shape")
  }

  const level = String(issue.level ?? "error").toLowerCase()
  const fatalAsCritical = config.fatalAsCritical !== false
  let severity: "critical" | "warn" | "info" =
    level === "fatal" && !fatalAsCritical ? "warn" : (LEVEL_MAP[level] ?? "warn")

  const prefix = (config.kindPrefix ?? "inbound.sentry").trim() || "inbound.sentry"
  const projectSlug = issue.project?.slug?.toLowerCase().replace(/[^a-z0-9-]+/g, "-") ?? "unknown"
  const kind = `${prefix}.${projectSlug}.${level}`

  const title = `[${issue.shortId ?? "Sentry"}] ${issue.title ?? "(no title)"}`

  return {
    clientName: ctx.tenantName,
    kind,
    severity,
    title: title.length > 200 ? title.slice(0, 197) + "…" : title,
    detailJson: JSON.stringify({
      issueId: issue.id ?? null,
      shortId: issue.shortId ?? null,
      level,
      project: issue.project?.slug ?? null,
      permalink: issue.permalink ?? null,
    }),
  }
}
