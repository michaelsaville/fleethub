import type { Mapper } from "./types"
import { uptimeRobotMapper } from "./uptimerobot"
import { datadogMapper } from "./datadog"
import { sentryMapper } from "./sentry"
import { genericMapper } from "./generic"

// Phase 8 Workstream A step 4-5 — central mapper registry. Adding a
// source = one new file + one entry here. Datadog and Sentry HMAC-
// verify inside themselves using configJson; generic + uptimerobot
// rely on the URL token alone.

export const MAPPERS: Record<string, Mapper> = {
  uptimerobot: uptimeRobotMapper,
  datadog: datadogMapper,
  sentry: sentryMapper,
  generic: genericMapper,
}

export const SUPPORTED_SOURCES = Object.keys(MAPPERS)
