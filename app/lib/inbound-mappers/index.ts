import type { Mapper } from "./types"
import { uptimeRobotMapper } from "./uptimerobot"

// Phase 8 Workstream A step 4 — central mapper registry. Adding a
// source = one new file + one entry here. Datadog/Sentry/generic
// mappers land in step 5; UptimeRobot is the first cut.

export const MAPPERS: Record<string, Mapper> = {
  uptimerobot: uptimeRobotMapper,
}

export const SUPPORTED_SOURCES = Object.keys(MAPPERS)
