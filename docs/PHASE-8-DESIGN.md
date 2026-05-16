# FleetHub Phase 8 — Hardening + Table-Stakes (Design)

**Status:** Draft, 2026-05-16. Not yet implemented. Phase 8 is the first
phase deliberately mixed between **closing visible product gaps** and
**paying down accumulated debt** from the prior seven phases. The
mix is the point — a pure-feature phase would compound debt the
audits below already flagged; a pure-debt phase would feel like
punishment with nothing to demo.

**Scope of this doc:** four workstreams. Like Phase 7, each is
independently shippable. Like prior phase docs, the spec IS the
contract.

The four workstreams:

- **A — Operator-authored monitors + external webhook ingestion.**
  Today every `Fl_Alert` comes from agent-emitted events or two
  hard-coded crons. There's no UI for "alert when free disk < 10%
  for 15m" and no way for Datadog / UptimeRobot / Sentinel to fire a
  FleetHub alert. This is the gap that loses demos vs Datto/Atera
  hardest.
- **B — Backup + AV/EDR posture ingest.** Read-only at first. Even
  parsing `Get-MpComputerStatus`, `manage-bde`, and Veeam/Datto status
  JSON into a posture column unblocks the second-most-common demo
  question: "are backups green and is Defender healthy?"
- **C — Design system + tech-debt pass.** Cross-phase audit found 5
  button geometries, 8 font sizes, `FIELD_STYLE` declared identically
  in 5 files, no test coverage, 600 lines of repeated channel-dispatch
  boilerplate, three near-identical HMAC implementations. Phase 8
  unifies them with surgical refactors — no rewrite, no framework
  swap.
- **D — Self-service + operator-quality-of-life surfaces.** Closes
  Phase 7's deferred items + the "Prisma-only" embarrassments in the
  activation checklist (staff phone editor, on-call membership UI,
  /fleet/patches, per-report download URLs, Cmd-K verbs for the
  setup flows that don't have them).

**Cross-references:**

- [`PHASE-2-DESIGN.md`](PHASE-2-DESIGN.md) — `Fl_ScriptRun` lifecycle that Workstream A's "evaluate threshold" monitors will reuse for the auto-remediation path
- [`PHASE-4-DESIGN.md`](PHASE-4-DESIGN.md) §3 — `Fl_PatchInstall.detection` shape that the Backup/AV posture (WS-B) mirrors for "did the agent see this?" semantics
- [`PHASE-7-DESIGN.md`](PHASE-7-DESIGN.md) §3 + §4 — Workstream A reuses the existing `Fl_Alert` + dispatch pipeline verbatim; monitors are just upstream emitters of alerts
- [`UI-PATTERNS.md`](UI-PATTERNS.md) — Workstream C's design-system pass codifies the patterns this doc has referenced since Phase 0 but never enforced
- [`HIPAA-READY.md`](HIPAA-READY.md) §5 — Workstream A's inbound webhook surface must respect PHI-aware logging when ingesting alerts from third-party tools

---

## 1. What Phase 8 ships

Concretely, by the end of each workstream:

**Workstream A — Monitors + inbound webhooks:**

- An operator can define a monitor at `/monitors/new`: "free disk %
  on Windows servers in tenant Acme, threshold < 10% for ≥15m,
  severity critical." On evaluation, the monitor writes an
  `Fl_Alert` through the existing `writeAlert()` and Phase 7's
  routing + escalation + runbooks pipe in unchanged.
- Monitor evaluation runs on a cron against `Fl_InventorySample` /
  `Fl_PerformanceSample` (already-collected agent telemetry —
  nothing new ingested per evaluation).
- External webhook ingestion at `/api/inbound/<token>` accepts a
  signed payload from third-party tools. Per-tool mappers translate
  the payload to the Fl_Alert shape. v1 ships mappers for
  UptimeRobot, Datadog, and a generic "JSON-shape" template; new
  mappers are one file each.

**Workstream B — Backup + AV/EDR posture:**

- New agent ingest paths: `posture.backup` and `posture.av` collect
  Veeam/Datto/restic/Windows-Backup last-run + Defender/Sophos/
  CrowdStrike engine state on every heartbeat (configurable).
- New columns on `Fl_Device`: `backupLastSuccess`, `backupLastError`,
  `avEngine`, `avSignaturesAt`, `bitlockerOn`, `warrantyExpiresAt` —
  surfaced on the existing `/devices/[id]` summary tab + the MSP
  triage table as new columns.
- Compliance scoring: a per-client posture score (0-100) derived
  from these signals + Phase 4 patch posture + Phase 5 evidence
  signing status. Single-number "are they on fire" metric.

**Workstream C — Design system + tech debt:**

- New `app/lib/ui-tokens.ts` exporting `BUTTON_PRIMARY`,
  `BUTTON_SECONDARY`, `BUTTON_DANGER`, `FIELD`, `TH`, `TD`,
  `LABEL_CAPS`, `CARD`, `CARD_HEADER` as React.CSSProperties.
  `app/components/ui/{Button,Chip,Card,EmptyState,ConfirmModal,Field}.tsx`
  componentize them.
- All Phase 2-7 pages migrated to the shared primitives. Sidebar
  emoji set unified (single visual family — pick lucide-as-SVG or
  one emoji style).
- Channel-adapter interface in `app/lib/alert-channels/`. Each
  channel becomes a single file implementing `AlertChannelAdapter`;
  `alert-dispatch.ts` collapses from 795 to ~250 lines.
- Hand-rolled validators replaced with zod schemas in
  `app/lib/schemas/`. zod is already a dependency.
- `withCronAuth(handler)` HOC adopted across the 10 cron routes.
- Shared HMAC sign + verify in `app/lib/hmac/`; FleetHub's three
  implementations (`bff-hmac.ts` + `bff-th-client.ts` + the
  WS-D portal verifier) collapse to one parameterized helper.
- Starter test suite: vitest + ~30 tests covering matchesAlert,
  parseEscalationChain, verifyHmac, all three validators,
  evaluateRunbooksForAlert, evaluatePredicate, resolveCurrentOncall.
- Mobile/tablet breakpoints: every page that uses `minWidth: 980` or
  fixed-width tables gets a card-stack fallback under 640px. Ack +
  Force-escalate fit on a phone screen end-to-end.

**Workstream D — Self-service + Cmd-K coverage:**

- `/setup/staff/[id]` editor: phone (E.164), on-call membership,
  notification prefs. Closes the "edit phoneE164 via Prisma"
  embarrassment from Phase 7 WS-A activation.
- Portal `/fleet/patches` view + BFF endpoint. Sanitized patch
  posture for the customer ("you have 12 patches pending; we'll
  apply them in your maintenance window").
- Portal per-report download URLs minted server-side. Closes the
  "coming soon" labels.
- Portal "Open a ticket from this fleet view" button → posts to
  TicketHub via the existing `FL_BFF_SECRET` BFF; one-click
  request for help directly from the fleet page.
- New Cmd-K verbs: `route slack #ops critical disk.*` (one-channel
  route in one keystroke), `oncall <schedule>`, `enroll device`,
  `enable portal <client>`, `branding <client>`, `rustdesk id <host>`.
- `<ConfirmModal>` adopted for every destructive op currently using
  `window.confirm` (route delete, runbook delete, schedule delete,
  manual escalation). Typed-name gate for the worst three.
- `rustdesk://` protocol-handler first-time registration flow on
  `/devices/[id]?tab=remote`.

## 2. The pain points each workstream is built around

Sourced from the four parallel audits run before drafting. The
"agent finding" columns reference the gap-finder, UX, UI, and code
reviewers respectively.

| Workstream | Decision | Counters this RMM failure / debt |
|---|---|---|
| A | Monitors authored in FleetHub, not the agent | Today only the agent decides what's alert-worthy. Operators can't add "alert if Spooler stopped >5m" without rebuilding the agent. Every other RMM has this on day one. (gap #1) |
| A | Inbound webhooks signed per-tool, mappers as code | Datto/Atera let UptimeRobot fire tickets; we silo by agent today. PHASE-7-DESIGN §13 explicitly listed this as Phase 8 territory. (gap #3) |
| B | Read-only posture first | Trying to "manage" backups + AV before just READING them is the gravestone of every from-scratch RMM. Read first; mutate when an operator asks. (gap #2) |
| C | Surgical refactors, no framework swap | Five button geometries + 8 font sizes + 5× duplicated FIELD_STYLE accumulated organically. A design-system PR is invisible if rolled into a feature phase; this phase owns it. (UI #1-5) |
| C | Channel adapter interface | 600 lines of repeated dispatch boilerplate in alert-dispatch.ts. Adding a 7th channel (Discord, ntfy, Mattermost) shouldn't be a 100-line PR. (code #1) |
| C | Starter test suite | Zero tests across the app today. With 27 JSON-as-string columns parsed at runtime + a dispatcher this branchy, regression risk grows with every commit. (code #5) |
| C | Mobile posture | UI-PATTERNS §3 calls out mobile as a category differentiator but every screen has `minWidth: 980` on its critical table. A tech on-call from a phone today can't ack without horizontal scroll. (UX #5) |
| D | Staff editor stops the "Prisma as UI" pattern | Phase 7 activation literally instructs `UPDATE fl_staff_users SET phoneE164 = '+1...'`. Embarrassing to demo. (gap #4) |
| D | Customer portal gains a write surface (ticket-from-fleet) | WS-D shipped read-only; customers who see "12 patches pending" can't act on them. (gap #5) |
| D | Cmd-K coverage for setup verbs | route/oncall/enroll/portal/branding/rustdesk-id all require navigating to settings. Closing this is one `palette-commands.ts` PR. (UX bonus) |
| D | Shared ConfirmModal | Destructive ops use raw `window.confirm` with no row context; non-destructive ones have no confirm at all. TicketHub's typed-name precedent applies. (UX #2) |

## 3. Workstream A — Monitors + inbound webhooks

### 3.1 Schema

```prisma
/// Operator-authored alert threshold. Cron-evaluates against
/// existing telemetry tables (Fl_PerformanceSample,
/// Fl_InventorySample). Emits Fl_Alert through writeAlert() so
/// every Phase 7 routing/escalation/runbook reaction fires as if
/// the alert came from the agent.
model Fl_Monitor {
  id              String   @id @default(cuid())
  name            String
  tenantName      String?  // null = applies to all tenants
  /// "perf.disk.percent" | "perf.cpu.avg" | "perf.ram.avg" |
  /// "inv.service.state" | ... — bounded set; one mapper per kind
  metric          String
  /// JSON match predicate scoped to the metric:
  ///   { operator: "lt"|"gt"|"eq"|"neq", value: N, deviceTag?: "...",
  ///     osFilter?: "windows"|"linux"|"darwin",
  ///     forMin: 15  // sustain duration before firing
  ///   }
  predicateJson   String
  severity        String   // "critical"|"warn"|"info"
  /// Alert kind to emit. Defaults to "monitor.<sanitized-name>"
  /// but operators can override (e.g. "disk.full") to route via
  /// existing Fl_AlertRoute matchJson without rebuilding rules.
  emitKind        String
  /// Cooldown per (deviceId, monitorId). 0 disables. Prevents
  /// flapping when the metric oscillates around the threshold.
  cooldownMin     Int      @default(30)
  isActive        Boolean  @default(true)
  createdBy       String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([isActive, tenantName])
  @@map("fl_monitors")
  @@schema("fleethub")
}

/// Inbound webhook endpoint for third-party tools. Each row
/// owns its own opaque token at /api/inbound/<token>. Per-tool
/// mapper translates the incoming JSON to the Fl_Alert shape.
model Fl_InboundWebhook {
  id              String   @id @default(cuid())
  name            String   // "Acme UptimeRobot"
  tenantName      String   // posts route to this tenant's channels
  /// "uptimerobot" | "datadog" | "sentry" | "generic" — picks the
  /// mapper. New tools are a new mapper file + one row here.
  source          String
  /// Opaque cuid-ish, used in the URL: /api/inbound/<token>. Stored
  /// in plain text since it IS the bearer.
  token           String   @unique
  /// JSON config the mapper consumes (severity-map overrides, kind
  /// prefixes, etc.). Shape is per-source.
  configJson      String?
  isActive        Boolean  @default(true)
  lastFiredAt     DateTime?
  fireCount       Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([source, isActive])
  @@map("fl_inbound_webhooks")
  @@schema("fleethub")
}
```

### 3.2 Monitor evaluator

Cron at `/api/cron/monitor-evaluate` (every 1m, bearer-gated).

1. Load all active monitors.
2. For each, look up the device set (tenant + osFilter + deviceTag).
3. For each device, evaluate the metric against the predicate using
   the last `forMin` minutes of telemetry.
4. If predicate is true sustained for the full window AND cooldown
   has lapsed, call `writeAlert({kind: emitKind, severity, ...})`.

Telemetry sources per metric kind:
- `perf.*` — `Fl_PerformanceSample` (Phase 5 step 3 rollup)
- `inv.service.*` — `Fl_InventorySample.servicesJson`
- `inv.process.*` — `Fl_InventorySample.processesJson`
- Future: `posture.*` (closes over Workstream B's columns)

### 3.3 Inbound webhook lifecycle

`POST /api/inbound/<token>`:

1. Look up `Fl_InboundWebhook` by token. 404 if missing/inactive.
2. Run the per-source mapper (`app/lib/inbound-mappers/<source>.ts`).
3. Mapper returns `{clientName, deviceId?, kind, severity, title,
   detailJson?}` or throws on un-mappable input.
4. `writeAlert()` with the mapped values. Routing pipes into
   Phase 7 unchanged.
5. Update `lastFiredAt` + `fireCount`.

Per-source authn is at the URL level (the token IS the secret).
Tools that support HMAC headers (Datadog, Sentry) gain optional
signature verification — config'd in `configJson` per-row.

### 3.4 UI surfaces

- `/monitors` — list (operator + tenant + last-fired + state chip).
- `/monitors/new` — wizard (Identity → Metric → Threshold →
  Emit → Behavior). Same 4-section shape as Phase 7's runbook
  wizard.
- `/monitors/[id]` — detail + recent-firings table.
- `/setup/inbound-webhooks` — list + per-row reveal-token + copy
  URL. New-webhook form picks source from a dropdown of mappers.
- Cmd-K: `monitor <q>`, `inbound webhook <q>`.

### 3.5 Sequencing inside Workstream A

1. `Fl_Monitor` schema + evaluator (no UI; hand-author rows).
2. `/monitors` list + detail.
3. `/monitors/new` wizard.
4. `Fl_InboundWebhook` schema + token generation + first mapper
   (uptimerobot).
5. Additional mappers (datadog, sentry, generic).
6. `/setup/inbound-webhooks` UI.

## 4. Workstream B — Backup + AV/EDR posture

### 4.1 Schema

```prisma
/// Phase 8 — posture columns on Fl_Device. All nullable; only
/// populated when the agent reports them on heartbeat.
// (Added to existing Fl_Device — see §9 for the full delta.)
// backupLastSuccess  DateTime?
// backupLastError    DateTime?
// backupLastErrorMsg String?
// backupProduct      String?  // "veeam"|"datto"|"restic"|"windows-backup"|"none"
// avEngine           String?  // "defender"|"crowdstrike"|"sophos"|"sentinelone"|"none"
// avEnabled          Boolean?
// avSignaturesAt     DateTime?
// bitlockerOn        Boolean?
// warrantyExpiresAt  DateTime?
```

### 4.2 Agent ingest

Two new methods in `AGENT-PROTOCOL.md`:
- `posture.backup` — agent runs the per-product detector +
  reports last success/failure + error message.
- `posture.av` — agent runs `Get-MpComputerStatus` on Windows,
  reads `/etc/rkhunter.conf` or equivalent on Linux + reports
  engine name, enabled state, signature age.

Both heartbeat-frequency (configurable per-tenant). The
ingest handlers update `Fl_Device.*` directly — no separate
sample table since the posture is a point-in-time snapshot,
not a time series.

### 4.3 Compliance scoring

A single 0-100 score per client, computed at MSP-rollup time:

```
score = 100
       - 10 * (hostsBehindPatch ratio)
       - 15 * (anyHostWithBackupLastSuccess>72h ratio)
       - 10 * (anyHostWithAvDisabled ratio)
       -  5 * (anyHostWithBitlockerOff & hipaaMode ratio)
       - 20 * (auditChainStatus=="broken-here" ? 1 : 0)
```

Surfaced on the MSP triage table as a new "Posture" column.
Customer portal's `/fleet` summary card shows the same score
(but without the breakdown — they don't need the levers).

### 4.4 UI surfaces

- `/devices/[id]` summary tab gains a "Posture" subsection.
- MSP triage table gains a "Posture" column (next to Risk).
- Customer portal `/fleet` summary gains the score as a card.

### 4.5 Sequencing

1. Schema additions (push).
2. Agent-side detectors land in the PCC2K-Agent repo.
3. `posture.backup` + `posture.av` ingest handlers.
4. `/devices/[id]` summary surfaces.
5. Posture column on `/msp` rollup.
6. Compliance score on customer portal `/fleet`.

## 5. Workstream C — Design system + tech debt

### 5.1 UI tokens + primitives

New files:
- `app/lib/ui-tokens.ts` — exports `BUTTON`, `FIELD`, `TH`, `TD`,
  `LABEL_CAPS`, `CARD`, `CARD_HEADER`, `CHIP` as
  `React.CSSProperties` constants. Sizes locked: table body 12.5,
  thead 10.5, body 13, caps-label 11.
- `app/components/ui/Button.tsx` — `<Button variant="primary|
  secondary|danger|ghost" size="sm|md">`.
- `app/components/ui/Chip.tsx` — `<Chip tone="ok|warn|bad|kev|
  neutral" variant="soft|solid">`.
- `app/components/ui/Card.tsx` + `<CardHeader>`.
- `app/components/ui/EmptyState.tsx` — `<EmptyState icon? title
  body action?>`.
- `app/components/ui/ConfirmModal.tsx` — typed-name gate optional.
- `app/components/ui/Field.tsx` — wraps label + input + hint.

Migration: every Phase 2-7 page swapped to the primitives. No
behavior change; pure visual unification.

### 5.2 Channel adapter interface

```ts
// app/lib/alert-channels/types.ts
interface AlertChannelAdapter<C extends ChannelConfig = ChannelConfig> {
  type: string  // matches Fl_AlertDispatch.channel
  send(alert: Fl_Alert, config: C, ctx: DispatchContext): Promise<{
    destination: string
    externalId?: string
  }>
  /** Pre-flight check (e.g. "no webhookUrl configured"). When this
   *  returns a reason, the dispatcher records state="failed" without
   *  attempting send. */
  preflight?(config: C): string | null
}
```

Channels live in `app/lib/alert-channels/{slack,teams,email,sms,
pagerduty,ticket}.ts`. `alert-dispatch.ts` collapses to a registry
+ a single `dispatchOneChannel(adapter, alert, config)`. Adding a
7th channel (Discord, ntfy) is one file.

### 5.3 zod schemas

`app/lib/schemas/` with:
- `severity.ts` — `z.enum(["critical","warn","info"])`
- `match.ts` — match-predicate schema reused by alert-routes,
  monitors, and runbooks
- `channel.ts` — discriminated union per channel type
- `e164.ts`, `email.ts`, `hhmm.ts` — atom schemas

`alert-route-validate.ts`, `runbook-validate.ts`,
`oncall-validate.ts` collapse to ~10 lines each that just compose
the schemas.

### 5.4 withCronAuth + shared HMAC

```ts
// app/lib/with-cron-auth.ts
export function withCronAuth(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async function (req: NextRequest) {
    const auth = req.headers.get("authorization") ?? ""
    const secret = process.env.FLEETHUB_AGENT_SECRET ?? ""
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    return handler(req)
  }
}
```

Adopted across all 10 cron routes.

`app/lib/hmac/{sign,verify}.ts` parameterized on header prefix +
secret. Three existing implementations consolidated.

### 5.5 Tests (starter set)

vitest + ~30 tests:
- `matchesAlert` — predicate combinations
- `parseEscalationChain` — invalid JSON, valid, partial
- `verifyHmac` — happy path + skew + tampered sig
- All three validators — happy path + each error branch
- `evaluateRunbooksForAlert` — cooldown, trip, predicate
- `evaluatePredicate` — exitCode + stdoutContains + stdoutRegex
- `resolveCurrentOncall` — rotation, override, no-match, inactive
- `computeRiskScore` — known inputs to known outputs

Tests run via `npm test` in the same docker build pipeline.

### 5.6 Mobile / tablet breakpoints

Every page with `minWidth: 980` on its critical table grows a
card-stack fallback under 640px. Specifically:
- `/msp` — triage table → card-per-client mobile view
- `/alerts/[id]` — action row stacks; Force escalate moves to
  overflow menu
- `/devices/[id]` — tab nav scrolls horizontally; KV grids
  collapse to one-column
- `/runbooks` + `/remote-sessions` — list pages stack

Sidebar mobile drawer was already there from Phase 6 step 2 —
extend to all routes.

### 5.7 Sequencing

1. ui-tokens + primitive components (no migration yet).
2. Migrate Phase 7 pages to primitives (most recent; lowest risk).
3. Migrate Phase 5-6 pages.
4. Migrate Phase 2-4 pages.
5. Channel adapter refactor.
6. zod validators.
7. withCronAuth + HMAC consolidation.
8. Starter test suite.
9. Mobile breakpoints.

## 6. Workstream D — Self-service + Cmd-K

### 6.1 Staff editor

`/setup/staff` list already exists; add `/setup/staff/[id]` editor:
- email (read-only)
- name
- phoneE164 (E.164 input + validation)
- on-call schedule memberships (multi-select)
- notification prefs (mute critical / warn / info per channel)

PATCH to a new `/api/admin/staff/[id]` route.

### 6.2 Customer portal additions

- `/fleet/patches` view on portal. New BFF endpoint
  `/api/bff/portal/fleet-patches` on FleetHub returning sanitized
  patch posture (count by severity band, no CVE IDs).
- Per-report download URLs: BFF endpoint
  `/api/bff/portal/fleet-report-download` mints a signed URL to
  `/api/reports/[id]/download` valid for 5 minutes. Portal
  `/fleet/reports` swaps "coming soon" for live links.
- "Open a ticket" button on `/fleet`. Single field — description —
  POSTs to TicketHub via `FL_BFF_SECRET` with the fleet context
  injected (number of devices, latest report, etc.).

### 6.3 Cmd-K coverage

New verbs in `palette-commands.ts`:
- `route <severity> <kind-glob> [client]` — opens
  `/setup/alert-routing/new` with the match pre-filled.
- `oncall <schedule-name>` — opens the schedule editor.
- `enroll device` — opens OpsHub `/agents/new` in a new tab.
- `enable portal <client>` — navigates to
  `/clients/<client>?tab=settings` with focus on the toggle.
- `branding <client>` — same, branding tab.
- `rustdesk id <host>` — opens `/devices/<id>?tab=remote` with
  focus on the peer-ID input.

### 6.4 ConfirmModal adoption

Replace every `window.confirm` call with `<ConfirmModal>` from
Workstream C. Add typed-name gate for:
- Route delete (type the route's tenant name)
- Runbook delete (type the runbook's name)
- Schedule delete (type the schedule's name)

### 6.5 Misc

- `rustdesk://` protocol-handler registration page at
  `/devices/[id]?tab=remote` — surfaces a one-time "Click here if
  your browser doesn't have a RustDesk handler registered" link.
- Fix the device action bar placebo buttons. Either hide unshipped
  actions until their phase lands, or replace with a single
  "Coming in Phase N — vote on roadmap" link.

### 6.6 Sequencing

1. Staff editor + on-call membership (closes the SQL-as-UI gap).
2. `<ConfirmModal>` adoption.
3. Cmd-K verbs.
4. `/fleet/patches` + BFF endpoint.
5. Per-report download URLs.
6. Open-a-ticket button on portal.

## 7. Shared infrastructure

- The ui-tokens + primitives from Workstream C are used by every
  new page in WS-A + WS-B + WS-D. Order WS-C before the
  user-visible pages.
- The schema additions in WS-A and WS-B push together.
- The new Cmd-K verbs in WS-D depend on the WS-A monitors + WS-D
  staff editor existing.
- Phase 7's WS-D BFF endpoints are reused for `fleet-patches` +
  `fleet-report-download`; same HMAC scheme + `PORTAL_BFF_SECRET`.

## 8. UI surface map

| Path | Workstream | Auth |
|---|---|---|
| `/monitors` | A | TECH read, ADMIN write |
| `/monitors/new`, `/monitors/[id]` | A | ADMIN |
| `/setup/inbound-webhooks` | A | ADMIN |
| `/api/inbound/<token>` | A | token-only (no session) |
| `/devices/[id]` posture section | B | TECH |
| `/setup/staff/[id]` | D | ADMIN |
| `/api/admin/staff/[id]` | D | ADMIN |
| portal `/fleet/patches` | D | Customer persona |
| `/api/bff/portal/fleet-patches` | D | HMAC bearer |
| `/api/bff/portal/fleet-report-download` | D | HMAC bearer |
| Existing pages, swapped to ui primitives | C | unchanged |

## 9. Schema additions (full delta vs Phase 7)

New models: `Fl_Monitor`, `Fl_InboundWebhook`.

`Fl_Device` additions:
- `backupLastSuccess`, `backupLastError`, `backupLastErrorMsg`,
  `backupProduct`
- `avEngine`, `avEnabled`, `avSignaturesAt`
- `bitlockerOn`
- `warrantyExpiresAt`

`Fl_StaffUser` additions:
- `notificationPrefsJson` (per-channel mute prefs)
- Many-to-many: `oncallScheduleIds[]` (or a join row
  `Fl_StaffOncall { userId, scheduleId }`)

No changes to existing Phase 7 tables.

## 10. Optional integrations + per-deploy decisions

- **UptimeRobot / Datadog / Sentry mappers** — operator supplies
  per-row config in `Fl_InboundWebhook.configJson`. Mappers are
  the only place that sees the raw third-party payload shape;
  swapping vendors is a one-file change.
- **Veeam vs Datto vs restic** — the agent detects which one is
  installed and uses the appropriate query. No per-tenant config.
- **AV engine** — same: agent picks by OS + installed-product.
- **Compliance score weights** — fixed in v1 (§4.3 formula).
  Operator override via `Fl_Tenant.complianceWeightsJson` is a
  v1.5 concern.

## 11. Sequencing across workstreams

The four workstreams are independent on code touch but share
the design-system primitives from Workstream C. Recommended
order:

1. **Workstream C first** (sections 5.1-5.6). Establishes the
   primitives every later page should use. Migration of existing
   pages is safe-to-defer per-page.
2. **Workstream D self-service piece** (6.1 staff editor) — closes
   the immediate SQL-as-UI embarrassment so Phase 7 WS-A activation
   stops being humiliating.
3. **Workstream A** in two cuts: monitors first (3.1-3.5 steps 1-3),
   then inbound webhooks (3.5 steps 4-6). The monitors are the gap
   most felt; webhooks unlock external tool integration.
4. **Workstream B** in parallel with WS-A if a second hand is
   available — they don't share code paths. Otherwise after WS-A.
5. **Workstream D Cmd-K + ConfirmModal + portal additions** —
   consolidating polish at the end.

Each workstream can ship standalone; the dependency between WS-D's
portal additions and the existing Phase 7 BFF scheme is the only
hard ordering constraint.

## 12. Open questions

- **Monitor evaluation cadence.** Per-monitor configurable, or
  fixed at 1 minute? v1 ships fixed 1m to keep ops simple; per-
  monitor overrides if anyone asks.
- **Compliance score formula tuning.** §4.3 weights are first-pass.
  Real-world MSP feedback after the first month will probably
  retune them. `Fl_Tenant.complianceWeightsJson` override deferred
  unless demanded.
- **AV/backup engine list** — v1 ships Defender / CrowdStrike /
  Sophos / SentinelOne for AV, and Veeam / Datto / restic /
  Windows-Backup for backup. Adding a new engine is a single
  detector in the agent + a string match in the parser; not a
  schema change.
- **Test framework.** vitest is the assumption (modern, fast,
  TS-native). If the operator prefers jest for consistency with
  TicketHub, swap is mechanical.
- **Sidebar emoji set.** Unify with lucide-as-SVG icons or pick a
  single emoji style (e.g. all monochrome geometric)? lucide is
  more polished but adds a dep + a few KB; emoji is dep-free but
  fonty-inconsistent across OSes. v1 picks emoji-monochrome unless
  operator preference says otherwise.

## 13. Non-goals (out of scope for Phase 8)

- **Mutable backup/AV management.** v1 reads posture only. "Trigger
  a Veeam backup from FleetHub" is a Phase 9 concern.
- **AI-driven alert correlation / root-cause clustering.** Out of
  scope; tracked separately.
- **White-label / multi-MSP federation.** PHASE-7-DESIGN §12 noted
  this; still out.
- **PWA / native mobile app.** Mobile responsive (§5.6) is in;
  installable / native is not.
- **Migrating away from inline styles.** Workstream C unifies
  what's there; doesn't swap the styling primitive.
- **Schema-level normalization of JSON columns.** The code-review
  audit specifically flagged this as out of scope — variable-shape
  JSON is the right call for matchJson / channelsJson / etc.

## 14. Voice check

Voice: this is the phase where FleetHub stops feeling like "an
ambitious side project that happens to ship features fast" and
starts feeling like "an RMM you'd let your sister-in-law run her
medical practice on." Every Workstream A decision answers "what
can our MSP-customer alert on without us touching code?" Every
Workstream B decision answers "is the box safe + protected?"
Every Workstream C decision answers "is this codebase still
joyful to extend?" Every Workstream D decision answers "can the
operator + customer self-serve without a Prisma session?"

No new sidebar emoji that don't match the others. No new
`window.confirm`. No new `FIELD_STYLE` constants. No new validator
files that don't compose from `app/lib/schemas/`. No new cron
route that doesn't go through `withCronAuth`. No new alert channel
that isn't a single-file adapter. The phase is about discipline
as much as features.
