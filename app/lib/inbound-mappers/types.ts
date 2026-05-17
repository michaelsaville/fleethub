// Phase 8 Workstream A step 4 — inbound webhook mapper contract.
// Each /api/inbound/<token> request runs the source-specific mapper;
// the mapper either returns a mapped alert shape (sometimes a list,
// since some tools batch multiple events per webhook) or throws to
// signal un-mappable input. The route logs errors back to the
// Fl_InboundWebhook row so an operator can see why a tool's posts
// are getting rejected.

export interface MappedAlert {
  clientName: string
  deviceId?: string | null
  kind: string
  severity: "critical" | "warn" | "info"
  title: string
  /// Stringified JSON. Carries source-specific identifiers so
  /// downstream UI / routing rules / runbooks can branch on them.
  detailJson?: string
}

/// Headers the mapper might want for HMAC verification or sender
/// fingerprinting. Lowercased canonical keys.
export type MapperHeaders = Record<string, string>

export interface MapperContext {
  /// The webhook row's tenantName. Mappers default to this when the
  /// payload doesn't carry a client identifier.
  tenantName: string
  /// Parsed `configJson` for the row, or null. Per-source shape.
  config: Record<string, unknown> | null
  /// Raw request body (string). Some sources sign bytes, not parsed
  /// JSON; mappers that verify HMAC need this.
  rawBody: string
  /// Lowercased headers. Mappers pluck `x-datadog-signature`,
  /// `sentry-hook-signature`, etc.
  headers: MapperHeaders
  /// Decoded body — most mappers consume this. Mapper-of-mappers
  /// guarantees JSON.parse already ran; if it didn't, the mapper
  /// can throw to surface the parse error to the operator.
  parsedBody: unknown
}

export type Mapper = (ctx: MapperContext) => Promise<MappedAlert | MappedAlert[]>

/// Thrown by mappers when the payload is well-formed but should not
/// produce an alert (e.g. UptimeRobot's "monitor up" pings after a
/// down event). The route returns 200 + records a fire to keep the
/// sender happy without writing a no-op alert.
export class IgnoredEvent extends Error {
  constructor(message: string) {
    super(message)
    this.name = "IgnoredEvent"
  }
}
