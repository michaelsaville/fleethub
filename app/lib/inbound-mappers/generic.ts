import type { Mapper, MapperContext } from "./types"

// Generic JSON mapper — for tools without a dedicated mapper, plus
// scripts/curl smoke tests. The contract is the writeAlert() shape
// pass-through:
//   {
//     "kind":     "external.foo.problem",   // optional, default "inbound.generic"
//     "severity": "warn",                   // optional, default "warn"
//     "title":    "Something is broken",    // REQUIRED
//     "deviceId": null,                     // optional
//     "detailJson": {...}                   // optional; object will be JSON.stringify'd
//   }
//
// The mapper is intentionally strict — fields that don't match the
// expected shape produce a 400 with the reason so a curl smoke
// shows the operator exactly what they're missing.

interface GenericPayload {
  kind?: unknown
  severity?: unknown
  title?: unknown
  deviceId?: unknown
  detailJson?: unknown
}

interface Config {
  /// Kind prefix when payload.kind isn't set. Default "inbound.generic".
  kindPrefix?: string
  /// Allow batch posts — { events: [...] } instead of a single object.
  allowBatch?: boolean
}

const VALID_SEVERITY = new Set(["critical", "warn", "info"])

export const genericMapper: Mapper = async (ctx: MapperContext) => {
  const config = (ctx.config ?? {}) as Config
  const allowBatch = config.allowBatch === true
  const body = ctx.parsedBody

  if (allowBatch && body && typeof body === "object" && "events" in body && Array.isArray((body as { events?: unknown }).events)) {
    const events = (body as { events: unknown[] }).events
    return Promise.all(events.map((e) => mapOne(e as GenericPayload, ctx, config)))
  }
  return mapOne(body as GenericPayload, ctx, config)
}

async function mapOne(p: GenericPayload | null, ctx: MapperContext, config: Config) {
  if (!p || typeof p !== "object") {
    throw new Error("Generic payload must be a JSON object")
  }
  const title = typeof p.title === "string" ? p.title.trim() : ""
  if (!title) throw new Error("title is required (string, non-empty)")
  if (title.length > 200) throw new Error("title must be 200 characters or fewer")

  const sevRaw = typeof p.severity === "string" ? p.severity.toLowerCase() : "warn"
  if (!VALID_SEVERITY.has(sevRaw)) {
    throw new Error(`severity must be "critical", "warn", or "info" (got ${JSON.stringify(p.severity)})`)
  }
  const severity = sevRaw as "critical" | "warn" | "info"

  const prefix = (config.kindPrefix ?? "inbound.generic").trim() || "inbound.generic"
  let kind: string
  if (p.kind === undefined || p.kind === null || p.kind === "") {
    kind = prefix
  } else if (typeof p.kind === "string") {
    if (!/^[a-z0-9._-]+$/.test(p.kind)) {
      throw new Error("kind must be lowercase letters, digits, dots, underscores, or dashes")
    }
    kind = p.kind
  } else {
    throw new Error("kind must be a string")
  }

  const deviceId =
    p.deviceId === undefined || p.deviceId === null
      ? null
      : typeof p.deviceId === "string"
        ? p.deviceId.trim() || null
        : (() => { throw new Error("deviceId must be a string or null") })()

  let detailJson: string | undefined
  if (p.detailJson !== undefined && p.detailJson !== null) {
    detailJson = typeof p.detailJson === "string"
      ? p.detailJson
      : JSON.stringify(p.detailJson)
  }

  return {
    clientName: ctx.tenantName,
    deviceId,
    kind,
    severity,
    title,
    detailJson,
  }
}
