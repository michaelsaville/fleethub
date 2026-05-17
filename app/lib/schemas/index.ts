// Phase 8 Workstream C §5.3 — schemas barrel. All callers import
// from "@/lib/schemas".

export { SeverityEnum, SeverityListLoose, type Severity } from "./severity"
export { EmailAddress } from "./email"
export { E164 } from "./e164"
export { HHMM } from "./hhmm"
export { MatchPredicate, normalizeMatch } from "./match"
export {
  ChannelConfig,
  ChannelList,
  SlackChannel,
  TeamsChannel,
  EmailChannel,
  SmsChannel,
  PagerDutyChannel,
  TicketChannel,
} from "./channel"
