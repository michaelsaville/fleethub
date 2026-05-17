import "server-only"
import type { Fl_Alert } from "@prisma/client"

// Phase 8 Workstream C §5.2 — channel adapter contract. Replaces
// the six near-identical dispatch* functions that used to live in
// alert-dispatch.ts. The dispatcher (a) calls `preflight` and
// records "failed" without invoking send if it returns a reason,
// (b) calls `send` and records "sent" with the returned
// destination/externalId on success, (c) records "failed" with
// the thrown Error's message if send throws.
//
// Adding a 7th channel (Discord, ntfy, etc.) is now a single new
// file in lib/alert-channels/ + a registry entry.

/**
 * Per-channel config shape from the alert-route channel array.
 * We keep it loose (Record<string, unknown>-ish) at this layer so
 * each adapter can narrow to what it actually needs. The
 * alert-route validator already enforces shape at write time.
 */
export interface ChannelConfig {
  type: string
  webhookUrl?: string
  toEmails?: string[]
  ccEmails?: string[]
  phoneNumbers?: string[]
  integrationKey?: string
  oncallScheduleId?: string
  [key: string]: unknown
}

export interface SendResult {
  /// Privacy-respecting fingerprint written to Fl_AlertDispatch.destination.
  /// e.g. "https://hooks.slack.com/services/T0XXX…", "2 recipients @ pcc2k.com",
  /// "pd ******abcd", "TH #4242".
  destination: string
  /// Optional remote identifier — Stripe-style dedup keys, PagerDuty dedup keys,
  /// TicketHub ticket ids, etc. Stored on Fl_AlertDispatch.externalId.
  externalId?: string
}

export interface AlertChannelAdapter<C extends ChannelConfig = ChannelConfig> {
  /// Matches Fl_AlertDispatch.channel + the channel.type discriminator.
  type: string
  /// Pre-flight check (e.g. "no webhookUrl configured"). Returning a
  /// non-null string makes the dispatcher record state="failed"
  /// without invoking send. Synchronous because preflights should
  /// never hit the network or DB.
  preflight?(config: C): string | null
  /// Side-effecting send. Throws to signal a runtime failure;
  /// dispatcher writes state="failed" with the thrown message.
  send(alert: Fl_Alert, config: C): Promise<SendResult>
}
