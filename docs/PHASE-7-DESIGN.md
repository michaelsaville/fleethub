# FleetHub Phase 7 — Active Operations + Integrations (Design)

**Status:** Draft, 2026-05-15. Not yet implemented. Phase 7 is gated on Phases 1–6 having shipped — the four workstreams each consume specific upstream phases (alerting depends on Phase 1 alerts + the Phase 6 surface; remediation depends on Phase 2 scripts; remote control depends on the Phase 1 agent; the portal join depends on the Super Portal pattern already proven by [`project_super_portal_phase_8`]).

**Scope of this doc:** four workstreams, bundled into one phase because each is foundational and they share infrastructure (notification channels, the audit chain, the agent transport). Each workstream is independently shippable — Phase 7 doesn't need to land in one chunk; the workstreams can interleave with other work or land in series. Like the prior phase docs: the spec IS the contract.

The four workstreams:

- **A — Alerting + escalation routing.** Make `Fl_Alert` finally do something. Notification channels (Slack/Teams/SMS/email/PagerDuty), on-call rotations, ack windows, escalation chains, auto-ticket creation in TicketHub.
- **B — Auto-remediation runbooks.** Alert-driven script orchestration: a disk-full alert triggers a cleanup script; a service-down alert triggers a restart. Reuses Phase 2's signed-script + dry-run gate. Runs through the same audit chain.
- **C — Remote control (RustDesk join).** Tether the existing RustDesk Pro stack on Openclaw into FleetHub. One-click remote-in from `/devices/[id]` with session lineage written to `Fl_AuditLog`.
- **D — Customer-facing portal join.** FleetHub joins the Super Portal at `portal.pcc2k.com` alongside TicketHub + DocHub. Clients see their own fleet, patch posture, and scheduled reports under the same persona model the other two apps already use.

**Cross-references:**
- [`PHASE-2-DESIGN.md`](PHASE-2-DESIGN.md) — `Fl_ScriptRun` lifecycle + signed-script enforcement; Workstream B builds directly on it
- [`PHASE-4-DESIGN.md`](PHASE-4-DESIGN.md) §10 — pre-patch safety gates; remediation runbooks reuse the same gate pattern
- [`PHASE-5-DESIGN.md`](PHASE-5-DESIGN.md) §8 — Slack/Teams `deliverTo*` helpers in `app/lib/webhook-delivery.ts` are the notification primitives Workstream A reuses unchanged
- [`PHASE-6-DESIGN.md`](PHASE-6-DESIGN.md) §3.1 — the "Needs your attention" rail surfaces what Workstream A routes; the two surfaces inform each other
- [`HIPAA-READY.md`](HIPAA-READY.md) §2 + §6 — every Phase 7 action writes an audit row; remote-control sessions in particular are PHI-adjacent
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) §8 — Workstream B emits `scripts.execute` requests; the existing namespace is reused with no protocol changes

---

## 1. What Phase 7 ships

Concretely, by the end of each workstream:

**Workstream A — Alerting + escalation:**
- Every `Fl_Alert` write evaluates the matching routing policy and dispatches notifications via configured channels. A "critical disk full on web-01" reaches the on-call engineer in <60s via Slack mention + SMS, automatically creates a TicketHub ticket, and starts an ack window.
- An operator can define per-client routing policies in `/settings/alert-routing`: "anything critical at Acme Health goes to #ops-acme + SMS to the on-call. Anything warn goes to #ops only."
- On-call rotations live in `Fl_OncallSchedule` (weekly default; per-day overrides). The current on-call is computed at notification time, not pre-resolved at schedule-create time.
- Acks live as a state transition on `Fl_Alert` (`ack` already exists in the schema — Phase 7 just wires the timer + escalation).
- A complete chain: alert fires → notifies primary → 5min ack window → escalates to secondary → 10min → escalates to on-call manager → 15min → auto-creates P1 ticket with full context.

**Workstream B — Auto-remediation runbooks:**
- An operator can define runbooks in `/runbooks/new`: "when alert kind = `disk.full` for a Windows device, run script `cleanup-temp.ps1` in dry-run, then if dry-run shows >2GB recoverable, run for real."
- Runbooks are gated identically to Phase 2 scripts: signed-script enforcement, audit-logged, dry-run default, ADMIN-only authoring.
- Per-runbook circuit breaker: max-N-fires-per-hour, max-N-failures-before-disabled. Once tripped, an alert (kind=`runbook.tripped`) fires — meta-loop without infinite recursion.
- A runbook never re-fires for the same alert + same device within `cooldownMin` minutes (default 30).

**Workstream C — Remote control:**
- A "Remote in" button on `/devices/[id]` opens a RustDesk client with the device's ID + a one-time access token. Operator never sees the device's permanent password.
- Session start writes `Fl_AuditLog` with action=`remote.session.opened`, includes the RustDesk session ID. Session end (or timeout) writes `remote.session.closed`. Operator-facing transcript in `/devices/[id]?tab=remote-sessions`.
- Per-tenant `Fl_Tenant.remoteControlEnabled` defaults to true for non-HIPAA, false for HIPAA — HIPAA tenants require an explicit per-session justification field written to the audit row (compliance-rationale for the session).
- No new transport — RustDesk Pro is the channel; FleetHub mediates the access-token issuance + audit lineage.

**Workstream D — Customer portal join:**
- FleetHub's customer-facing surface mounts at `portal.pcc2k.com/fleet/*` under the existing Super Portal shell. Persona = customer (the existing one).
- A logged-in client sees: their fleet (one row per host with online status + last seen), their patch posture (which hosts are behind, by how much), their scheduled reports (with download links to the most recent ones), and their open alerts (read-only — they can't ack from the portal).
- All reads route through a new BFF endpoint pair on FleetHub: `POST /api/bff/portal/fleet-summary` + `POST /api/bff/portal/fleet-devices`, both HMAC-signed via a new `PORTAL_BFF_SECRET` (matching the existing TicketHub + DocHub pattern).
- Per-client opt-in. `Fl_Tenant.portalEnabled` defaults to false; an MSP staff member flips it in `/clients/[name]/settings`.

## 2. The pain points each workstream is built around

| Workstream | Decision | Counters this RMM failure |
|---|---|---|
| A | Alert → notification → ack → escalation, all in one chain | Datto / Connectwise fire 47 alerts per hour, all to the same email. Operators set up email filters that hide them. Critical alerts arrive in a deleted-items folder. |
| A | Routing policies are per-client, not global | Atera's global routing means a noisy dev client floods the same Slack channel as a healthcare client; ops eventually mutes everything. |
| A | Auto-tickets carry the full alert chain context | Most RMMs auto-create tickets with the alert title only. Tech opens the ticket and has to go back to the RMM to see what happened. |
| B | Runbooks run signed-script-only with dry-run default | The "self-healing" feature in legacy RMMs runs arbitrary cmd.exe. One ransomware vendor abused this in 2021; vendors quietly removed the feature. We keep it, signed. |
| B | Per-runbook circuit breaker | Without one, a misconfigured runbook running every 60s on an alert that won't clear blows up the agent fleet. Datto's auto-remediation history is a graveyard of these incidents. |
| C | RustDesk session ID is in the audit row | Most "remote in" features audit "operator X opened a session" with no way to correlate to the actual RustDesk session that lives on a different server. Auditor asks "what did the tech do?" → shrug. |
| C | Per-session HIPAA justification field | Auditors care about *why* the tech remoted in, not just that they did. The justification is a soft control the auditor can sample. |
| D | Customer portal is read-only by default | Customer-self-service can quickly become customer-self-destruct. Phase 7 v1 has no client-side actions; the panic-button "let the customer reboot a host" idea waits for explicit demand + an extra confirmation layer. |
| D | Mounts under existing Super Portal shell | A fourth distinct customer-facing app is a fourth password and a fourth bookmark. Reuse the persona model TicketHub + DocHub already proved out. |

## 3. Workstream A — Alerting + escalation routing

### 3.1 Schema

```prisma
model Fl_AlertRoute {
  id              String   @id @default(cuid())
  tenantName      String?  // null = applies to all tenants (the default route)
  /// JSON predicate: { severity: "critical" | "warn" | ["critical","warn"], kindLike: "disk.*", deviceTag: "prod" }
  matchJson       String
  /// JSON channels: [{type: "slack", webhookUrl, mention: "@oncall"}, {type:"sms", phoneNumbers:[]}, {type:"ticket", board:"ops"}]
  channelsJson    String
  /// JSON escalation chain: [{afterMin: 5, channels: [...]}, {afterMin: 15, channels: [...]}]
  escalationJson  String?
  /// Idempotent dedup window per (alert.kind, alert.deviceId). 0 = no dedup.
  dedupWindowMin  Int      @default(15)
  isActive        Boolean  @default(true)
  /// Lower priority = evaluated first. First match wins.
  priority        Int      @default(100)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([tenantName, priority, isActive])
  @@map("fl_alert_routes")
  @@schema("fleethub")
}

model Fl_AlertDispatch {
  id              String   @id @default(cuid())
  alertId         String
  alert           Fl_Alert @relation(fields: [alertId], references: [id], onDelete: Cascade)
  routeId         String?  // null when no route matched (default-drop)
  channel         String   // "slack" | "teams" | "sms" | "email" | "pagerduty" | "ticket"
  destination     String   // webhook URL hash, phone tail, ticket id, etc — never raw secrets
  state           String   // "pending" | "sent" | "failed" | "acked"
  ackedAt         DateTime?
  ackedBy         String?
  /// Which escalation step in the chain (0 = primary, 1 = first escalation, ...).
  escalationStep  Int      @default(0)
  /// Time after which this dispatch should escalate (null when at end of chain).
  escalateAt      DateTime?
  externalId      String?  // PagerDuty incident ID, TH ticket ID, etc
  errorReason     String?
  createdAt       DateTime @default(now())
  @@index([alertId, escalationStep])
  @@index([state, escalateAt])
  @@map("fl_alert_dispatches")
  @@schema("fleethub")
}

model Fl_OncallSchedule {
  id              String   @id @default(cuid())
  name            String   // "Ops primary", "Healthcare on-call"
  /// JSON: array of { userId, dayOfWeek: 0-6, start: "09:00", end: "17:00" }.
  /// Overrides take priority. Timezone is UTC; tenant TZ resolution
  /// happens at notification time.
  rotationJson    String
  /// JSON array of { userId, start: "2026-06-01T00:00Z", end: "2026-06-08T00:00Z", reason: "vacation cover" }
  overridesJson   String?
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@map("fl_oncall_schedules")
  @@schema("fleethub")
}
```

### 3.2 Lifecycle

1. `Fl_Alert` is written (existing writers everywhere — Phase 1 onward).
2. A Prisma middleware hook on `Fl_Alert.create` (or a post-create call from each writer; middleware is the cleaner option) enqueues a dispatch evaluation. **Synchronous in v1** — the alert writer awaits dispatch. Critical alerts can't tolerate "we'll get to it eventually."
3. Evaluator walks `Fl_AlertRoute` in priority order, filters by `tenantName` (specific > null), evaluates `matchJson` against the alert. First match wins.
4. For each channel in the matched route, create an `Fl_AlertDispatch` row with state=pending, then dispatch via the existing `lib/webhook-delivery` (Slack/Teams) or new channel adapters (SMS via Twilio, PagerDuty via Events API v2).
5. If the route has `escalationJson`, set `escalateAt = now + chain[0].afterMin` and a cron worker polls dispatches with `state=sent AND escalateAt < now AND ackedAt IS NULL` — escalates by creating the next step's dispatches.
6. Ack happens by URL or in-app: every Slack/Teams/email link carries a signed ack token (`/api/alerts/[id]/ack?token=...`); clicking sets `alert.state="ack"`, all open dispatches for that alert get `ackedAt`, escalation chain stops.

### 3.3 Channel adapters

- **Slack / Teams:** reuse `app/lib/webhook-delivery.ts` from Phase 5 step 8 verbatim. Already Block Kit / MessageCard.
- **Email:** reuse `app/lib/m365-mail.ts` already used by scheduled reports.
- **SMS:** new `app/lib/sms-twilio.ts`. Twilio is the v1 provider (well-known, cheap, well-documented webhook). Operator-supplied account SID + auth token in env. Falls back to email when not configured.
- **PagerDuty:** new `app/lib/pagerduty.ts`. Events API v2 (the "create incident" endpoint). Operator-supplied integration key in route config (not env — multi-team MSPs may use different PagerDuty services per client).
- **Ticket:** new `app/lib/auto-ticket.ts`. POSTs to `TICKETHUB_BASE_URL/api/bff/fleet/create-ticket` (a route TH must add — Phase 7.5 of TicketHub). HMAC-signed via `FL_BFF_SECRET` (the placeholder from Phase 1's `bff-th-client.ts` finally gets a user).

### 3.4 UI surfaces

- `/settings/alert-routing` — list of routes, sortable by priority, drag-to-reorder. Each row links to `/settings/alert-routing/[id]`.
- `/settings/alert-routing/[id]` — visual policy editor. Match builder (severity dropdowns + kind glob input + tag filter). Channel picker with per-channel config. Escalation chain builder (add step → afterMin + channels).
- `/settings/oncall-schedules` — list of schedules.
- `/settings/oncall-schedules/[id]` — calendar view (rotation grid) + override list.
- `/alerts/[id]` extended — adds a "Dispatch history" sidebar showing every notification sent for this alert, when, to which channel, and ack status.
- Cmd-K: `ack <alert-id>`, `escalate <alert-id>`.

### 3.5 Sequencing inside Workstream A

1. `Fl_AlertRoute` + `Fl_AlertDispatch` schema + the evaluator with Slack-only output. Default route hardcoded for the first cut.
2. Channel adapters: email + Teams (reusing Phase 5 helpers).
3. `/settings/alert-routing` list + editor UI.
4. Escalation chain + cron worker (the polling escalator).
5. SMS via Twilio.
6. PagerDuty.
7. Auto-ticket (depends on TicketHub-side route landing — coordinate).
8. On-call schedules + per-time-of-day routing.
9. Ack URL + Cmd-K verbs.

## 4. Workstream B — Auto-remediation runbooks

### 4.1 Schema

```prisma
model Fl_Runbook {
  id              String   @id @default(cuid())
  name            String   // "Cleanup temp files when disk full"
  description     String?
  /// JSON match predicate, same shape as Fl_AlertRoute.matchJson.
  matchJson       String
  /// Reference to an existing Fl_Script. The runbook never inlines a script;
  /// scripts go through Phase 2's signed-script lifecycle first.
  scriptId        String
  script          Fl_Script @relation(fields: [scriptId], references: [id])
  /// Number of minutes to wait after the alert fires before the
  /// runbook is allowed to fire. Lets a transient alert clear without
  /// running anything.
  graceMin        Int      @default(2)
  /// Cooldown per (alert.kind, alert.deviceId). The runbook won't
  /// re-fire for the same kind+device within this window.
  cooldownMin     Int      @default(30)
  /// Dry-run-first: run with --dry-run flag, evaluate exit + stdout
  /// against a JSON predicate, then run for real if predicate passes.
  /// When false, the runbook runs for real immediately.
  dryRunFirst     Boolean  @default(true)
  /// JSON predicate evaluated against dry-run output to decide whether
  /// to proceed with the real run. e.g. { stdoutContains: "would free" }.
  dryRunPredicateJson String?
  /// Circuit breaker: max fires per hour across the fleet.
  maxFiresPerHour Int      @default(10)
  /// Circuit breaker: consecutive failures before auto-disable.
  maxConsecutiveFailures Int @default(3)
  /// Auto-disabled flag, set by the circuit breaker. Operator must
  /// re-enable explicitly.
  isTripped       Boolean  @default(false)
  trippedReason   String?
  trippedAt       DateTime?
  isActive        Boolean  @default(true)
  createdBy       String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([isActive, isTripped])
  @@map("fl_runbooks")
  @@schema("fleethub")
}

model Fl_RunbookFire {
  id              String   @id @default(cuid())
  runbookId       String
  runbook         Fl_Runbook @relation(fields: [runbookId], references: [id], onDelete: Cascade)
  alertId         String?  // null when manually fired
  deviceId        String
  /// Cycle through dry-run → predicate-eval → real-run. State machine.
  state           String   // "pending" | "dry-run" | "predicate-failed" | "running" | "succeeded" | "failed" | "skipped-cooldown" | "skipped-tripped"
  dryRunScriptRunId   String?  // FK to Fl_ScriptRun (Phase 2)
  realScriptRunId     String?  // FK to Fl_ScriptRun (Phase 2)
  predicateOutcome    String?  // "pass" | "fail" | "skip"
  failureReason       String?
  createdAt       DateTime @default(now())
  completedAt     DateTime?
  @@index([runbookId, createdAt])
  @@index([alertId])
  @@map("fl_runbook_fires")
  @@schema("fleethub")
}
```

### 4.2 Lifecycle

1. Alert fires (Workstream A evaluator runs first).
2. Runbook evaluator runs after (same Prisma middleware, second step). For each active, non-tripped runbook whose `matchJson` matches:
3. Check cooldown — recent `Fl_RunbookFire` for this (runbookId, deviceId, alertKind) within `cooldownMin`? Skip with `state=skipped-cooldown`.
4. Check circuit breaker: count fires in last 1h. >= `maxFiresPerHour`? Trip the runbook; alert kind=`runbook.tripped` fires (which itself may route to Slack via Workstream A — a useful self-loop).
5. Wait `graceMin` minutes (a scheduled wakeup, not a sleep). If the source alert resolves before then, abort with `state=skipped-cleared`.
6. If `dryRunFirst`: enqueue `Fl_ScriptRun` (Phase 2) with `dryRun=true`. Wait for completion. Evaluate `dryRunPredicateJson` against output.
7. If predicate passes: enqueue real `Fl_ScriptRun` with `dryRun=false`. Both runs link back to the `Fl_RunbookFire` row.
8. On success: write audit row `runbook.fired`. On failure: write audit row, increment consecutive-failures counter. If >= `maxConsecutiveFailures`: trip the runbook.

### 4.3 UI surfaces

- `/runbooks` — list of runbooks, with status chips (active / tripped / disabled). Recent fires summary per row.
- `/runbooks/new` — wizard form. Choose alert match → choose Fl_Script → configure grace + cooldown + dry-run + predicate → confirm.
- `/runbooks/[id]` — detail view. History of fires (table), circuit-breaker state, edit, disable, untrip.
- `/runbooks/[id]/fires/[fireId]` — single fire detail. Links to the underlying Fl_ScriptRun rows (dry + real) with full stdout/stderr.

### 4.4 Sequencing inside Workstream B

1. `Fl_Runbook` + `Fl_RunbookFire` schema + the evaluator (no UI yet, hand-write a runbook row, watch it fire).
2. `/runbooks` list + `/runbooks/[id]` detail.
3. `/runbooks/new` wizard form.
4. Circuit breaker + auto-trip.
5. Dry-run + predicate evaluation flow.
6. Cmd-K: `disable runbook <name>`, `untrip <runbook-name>`.

## 5. Workstream C — Remote control (RustDesk join)

### 5.1 Schema

```prisma
model Fl_RemoteSession {
  id              String   @id @default(cuid())
  deviceId        String
  device          Fl_Device @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  operatorEmail   String
  /// RustDesk Pro session ID returned by the management API at session start.
  rustdeskSessionId   String?
  /// One-time access token minted by FleetHub, redeemed by the operator's
  /// RustDesk client. Tokens are short-lived (default 5 minutes).
  accessTokenHash String   // bcrypt or argon2 of the raw token
  accessTokenExpiresAt DateTime
  /// HIPAA-mode justification. Required for HIPAA tenants; null otherwise.
  justification   String?
  state           String   // "issued" | "in-progress" | "closed" | "expired" | "revoked"
  startedAt       DateTime?
  endedAt         DateTime?
  /// Bytes transferred over the RustDesk channel, if the Pro API reports it.
  /// Useful for the audit trail: a 4-hour session that moved 50GB needs explanation.
  bytesTransferred BigInt?
  createdAt       DateTime @default(now())
  @@index([deviceId, createdAt])
  @@index([state, accessTokenExpiresAt])
  @@map("fl_remote_sessions")
  @@schema("fleethub")
}
```

`Fl_Tenant` gains:

```prisma
remoteControlEnabled    Boolean  @default(true)
/// When true, every Fl_RemoteSession.create REQUIRES a non-empty
/// justification string. Default for HIPAA-mode tenants.
remoteRequiresJustification Boolean @default(false)
```

### 5.2 Lifecycle

1. Operator clicks "Remote in" on `/devices/[id]`.
2. If `tenant.remoteRequiresJustification`, a modal prompts for the reason (free-text, audit-logged). On submit, FleetHub:
3. Calls the RustDesk Pro management API (`POST /api/peer-token` or similar — the Pro management surface lives at `rustdesk.pcc2k.com:21114`) to mint a per-session token. Token is short-lived.
4. Creates `Fl_RemoteSession` with state=issued, writes the bcrypt'd token hash + the RustDesk session ID returned by the API.
5. Writes an audit row `remote.session.opened` with operator, device, tenant, justification, RustDesk session ID.
6. Returns a deep link `rustdesk://session/<id>?token=<one-time-token>` that the operator's local RustDesk client picks up automatically (URL handler registration is a Phase 7.5 polish).
7. Operator's RustDesk client connects. FleetHub polls the RustDesk Pro API every 30s for session state. State transitions to "in-progress".
8. On disconnect (either side), state → "closed". Bytes-transferred + duration audited. `remote.session.closed` row written.

### 5.3 UI surfaces

- `/devices/[id]` — "Remote in" button next to maintenance toggle. Disabled when `tenant.remoteControlEnabled` is false (with a chip explaining why).
- `/devices/[id]?tab=remote-sessions` — historical sessions for this device. Operator email, start/end, duration, bytes, justification, RustDesk session ID.
- `/remote-sessions` — fleet-wide active + recent sessions. Filterable by operator + client + date.
- `/clients/[name]/settings` — toggle `remoteControlEnabled` + `remoteRequiresJustification` per tenant.

### 5.4 Sequencing inside Workstream C

1. `Fl_RemoteSession` schema + per-tenant toggle. No UI yet.
2. RustDesk Pro management API client + token minting. CLI smoke first.
3. "Remote in" button on `/devices/[id]` + the justification modal.
4. Audit row writes + session-state polling cron.
5. `/devices/[id]?tab=remote-sessions` tab.
6. Fleet-wide `/remote-sessions` page.
7. URL-handler registration polish (`rustdesk://` deep link auto-handling).

## 6. Workstream D — Customer-facing portal join

### 6.1 BFF surface

A new BFF prefix on FleetHub: `/api/bff/portal/*`. All routes HMAC-signed via a new `PORTAL_BFF_SECRET` shared between the Super Portal and FleetHub. Same signing pattern as the existing `bff-th-client.ts` (Phase 1 placeholder).

- `POST /api/bff/portal/fleet-summary` — body: `{ portalUserId, clientName }`. Verifies the (portalUserId, clientName) link via the existing portal schema, returns a sanitized rollup: `{ deviceCount, onlineCount, openAlerts (count only — never titles), latestPatchScan, latestReportId }`.
- `POST /api/bff/portal/fleet-devices` — same auth shape. Returns the device list scoped to the client. Sanitized: hostname, OS, last-seen, online state. No IPs, no inventory.
- `POST /api/bff/portal/fleet-reports` — list scheduled-report artifacts for this client. Returns metadata + signed-download URLs.

### 6.2 Super Portal mount

Mount under `portal.pcc2k.com/fleet/*` in the existing Super Portal repo (`~/portal`). Persona = customer (no new persona). Reuses the `PortalUserClientLink` scope check the existing portal Vault + Pending surfaces use.

Pages on the Super Portal side:
- `/fleet` — summary card grid: devices online / total, open-alerts count, last patch scan, most-recent report link.
- `/fleet/devices` — device table.
- `/fleet/patches` — patch posture by host. No deploy actions, read-only.
- `/fleet/reports` — historical report downloads.

### 6.3 Permission model

Per-client opt-in:

```prisma
// Fl_Tenant additions
portalEnabled       Boolean  @default(false)
/// When false, /fleet/reports does NOT include reports older than this many days.
/// Default 90. HIPAA tenants may want this tighter; non-HIPAA may want unlimited.
portalReportMaxAgeDays  Int  @default(90)
```

MSP staff flip the toggle in `/clients/[name]/settings`. Customer-side login uses the existing Super Portal credential surface — no FleetHub-side login changes.

### 6.4 UI surfaces

- `/clients/[name]/settings` (FleetHub side) — adds the portal enable toggle + report-age cap.
- `portal.pcc2k.com/fleet/*` (portal side) — four read-only pages above.

### 6.5 Sequencing inside Workstream D

1. BFF endpoints on FleetHub + `PORTAL_BFF_SECRET` env. Smoke from curl.
2. `Fl_Tenant.portalEnabled` toggle + `/clients/[name]/settings` UI.
3. Super Portal `/fleet` summary page.
4. Super Portal `/fleet/devices` table.
5. Super Portal `/fleet/patches` posture view.
6. Super Portal `/fleet/reports` historical-report list.

## 7. Shared infrastructure

The four workstreams reuse a handful of cross-cutting primitives. Listing them here so the dependency surface is explicit:

- **Webhook delivery** (`app/lib/webhook-delivery.ts`, Phase 5 step 8) — Workstream A reuses Slack/Teams adapters verbatim. New adapters (SMS, PagerDuty, Email-as-fallback) land in the same file as additional `deliverTo*` functions.
- **Audit chain** (`app/lib/audit-chain.ts`, Phase 6 step 1) — every Workstream A dispatch, B fire, C session open/close writes an audit row through `writeAudit()`. The hash chain remains the single tamper-evidence surface.
- **Cron** — the existing host-side crontab gets two new lines: `escalation-tick` (Workstream A, every minute) and `runbook-tick` (Workstream B, every minute). Both bearer-auth via `FLEETHUB_AGENT_SECRET`.
- **BFF** (`app/lib/bff-th-client.ts`, Phase 1 placeholder) — finally consumed by Workstream A (auto-ticket) + Workstream D (portal). The HMAC + signature header pattern stays unchanged.
- **MSP rollup** ([`project_fleethub_phase6_live`]) — Workstream A's dispatched-alert state surfaces in the rail; Workstream B's tripped runbooks become a new rail card kind in v1.5.

## 8. UI surface map

| Path | Workstream | Auth |
|---|---|---|
| `/settings/alert-routing` | A | ADMIN |
| `/settings/alert-routing/[id]` | A | ADMIN |
| `/settings/oncall-schedules[+/id]` | A | ADMIN |
| `/runbooks[+/new+/id+/id/fires/fireId]` | B | ADMIN write, TECH read |
| `/remote-sessions` | C | TECH read |
| `/devices/[id]?tab=remote-sessions` | C | TECH read |
| `/clients/[name]/settings` (extended) | C + D | ADMIN |
| `portal.pcc2k.com/fleet/*` | D | Customer persona |
| `/api/alerts/[id]/ack` | A | signed-token (no session) |
| `/api/bff/portal/*` | D | HMAC bearer |

## 9. Schema additions (full delta vs Phase 6)

New models: `Fl_AlertRoute`, `Fl_AlertDispatch`, `Fl_OncallSchedule`, `Fl_Runbook`, `Fl_RunbookFire`, `Fl_RemoteSession`.

`Fl_Tenant` additions: `remoteControlEnabled`, `remoteRequiresJustification`, `portalEnabled`, `portalReportMaxAgeDays`.

No changes to existing tables. The Phase 6 rollup lib gains an opt-in column for "active dispatches" and "tripped runbooks" once Workstreams A + B land, but that's an additive `select` change inside `listMspRollup`, not a schema change.

## 10. Optional integrations + per-deploy decisions

- **Twilio for SMS** — operator supplies SID + token. v1 ships with Twilio only; if/when an operator asks for another provider (Bandwidth, AWS SNS) the adapter pattern is well-isolated.
- **PagerDuty** — operator supplies integration key per route. Each tenant could use a different PagerDuty service; routes carry the key, env doesn't.
- **RustDesk Pro management API** — assumes the API surface documented at `rustdesk.pcc2k.com:21114`. Schema-stable through RustDesk Pro 1.2.x as of design time. If the API changes shape, the adapter is one file.
- **TicketHub auto-ticket endpoint** — requires a TH-side BFF route. Phase 7.5 on the TH side. FleetHub Workstream A's auto-ticket channel renders disabled with a clear "TicketHub auto-ticket route not deployed" hint until that ships.

## 11. Sequencing across workstreams

The four workstreams are independent — they share infrastructure but not code paths. Recommended order:

1. **Workstream A first** (steps 1–4 of §3.5). Establishes the notification infrastructure that B and the rest of Phase 7 reuse. Even without escalation chains landed, step 1 + step 2 is a meaningful win.
2. **Workstream C in parallel.** Touches different files; the only cross-cutting concern is the audit chain (which Workstream A already exercises heavily by the time C lands). A small team could land both at once.
3. **Workstream B next.** Depends on A's match-predicate evaluator (reused) + Phase 2's signed-script lifecycle (unchanged).
4. **Workstream D last.** Customer-facing surfaces benefit from the rest of the phase being settled — fewer "we changed it again" mid-flight.

This is recommended, not mandatory. Each workstream can ship standalone; the dependency between B and A's evaluator is the only hard ordering constraint.

## 12. Open questions

- **Throttling on the alert evaluator.** A storm of 200 alerts in 30s — does each one synchronously evaluate routes + dispatch? At MSP scale (~12 clients, ~50 hosts each) probably fine. At 200-client scale it isn't. Out-of-the-gate v1 is synchronous; v1.5 introduces a queue if measured load justifies it.
- **Workstream D scope creep.** "Show me my fleet" naturally invites "let me reboot a host." Decided: v1 is read-only. Need an explicit Phase 7.5 to add any customer-side mutation.
- **RustDesk Pro vs free RustDesk.** Pro has the management API; free doesn't. Workstream C assumes Pro. If a deployment uses free, the "Remote in" button is gated off and a doc link explains why.
- **On-call schedule timezone semantics.** The schedule rotation is UTC-stored, tenant-TZ-resolved at notification time. Daylight saving transitions on the tenant side could mean a "9am-5pm" slot is 9 hours one day and 11 the next. v1 punts this — tenant-side admins adjust if it matters. v1.5 might add explicit DST-aware semantics.
- **Auto-ticket fingerprinting.** Should an auto-ticket created by a flapping alert (fires every 10min, clears every 5min) keep re-creating tickets? v1 fingerprints on (alert.kind, deviceId, hourly-bucket) — same fingerprint within the bucket reuses the existing ticket. Refinable later.

## 13. Non-goals (out of scope for Phase 7)

- **Customer-side actions in the portal.** Workstream D is read-only.
- **Webhook ingestion FROM external systems.** FleetHub doesn't accept inbound webhooks (e.g., "Datadog says this server is down → create an FleetHub alert"). Phase 8 territory.
- **AI-driven alert correlation.** "These 3 alerts are the same root cause" is a clustering problem; not in scope. Operators correlate manually for now.
- **Multi-tenant escalation policies** that span clients (one on-call rotation for all clients). v1 has per-tenant schedules; a "shared" schedule is just used by multiple tenants. A cross-tenant abstraction lands when an operator asks.
- **PII / PHI scrubbing in notifications.** Slack/Teams messages include alert titles + device hostnames. A HIPAA-mode tenant might want hostnames redacted in chat messages. Tracked separately; not Phase 7 default.

## 14. Voice check

Voice: this is the phase that turns FleetHub from "good dashboard" into "RMM you can stake your weekend on." Every Workstream A decision should answer "will the right human get paged in time?" — and every Workstream B decision should answer "is it safe to let a robot do this?" — and every Workstream C decision should answer "can an auditor reconstruct what the tech did to a customer machine?" — and every Workstream D decision should answer "does my client now understand their fleet without calling support?"

No tooltips. No "send a sample notification" widgets that send to the wrong channel. No "auto-remediation enabled" toggle that doesn't say what it's doing. Action → ack → audit. Every Phase 7 surface obeys that triplet.
