import "server-only"
import type { AlertChannelAdapter } from "./types"
import { slackAdapter } from "./slack"
import { teamsAdapter } from "./teams"
import { emailAdapter } from "./email"
import { smsAdapter } from "./sms"
import { pagerdutyAdapter } from "./pagerduty"
import { ticketAdapter } from "./ticket"

// Phase 8 Workstream C §5.2 — channel adapter registry. The
// dispatcher looks up the adapter by channel.type; an unknown
// type records state="skipped-no-channel" with a clear error
// reason (same behavior as the pre-refactor default branch).

export const ALERT_CHANNEL_ADAPTERS: Record<string, AlertChannelAdapter> = {
  slack: slackAdapter,
  teams: teamsAdapter,
  email: emailAdapter,
  sms: smsAdapter,
  pagerduty: pagerdutyAdapter,
  ticket: ticketAdapter,
}

export type { AlertChannelAdapter, ChannelConfig, SendResult } from "./types"
