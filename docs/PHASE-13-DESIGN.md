# FleetHub Phase 13 — Final Polish + Project Close (Design)

**Status:** Draft, 2026-05-18. Not yet implemented. Phase 13 is **THE
FINAL PHASE** per `docs/ROADMAP.md`. After Phase 13 ships, the
project is DONE; any future work becomes **v1.1** (operator-driven
follow-up release, NOT Phase 14). Items declared "non-goals" become
Phase 14+ ideas only — meaning a new design pass, not a backlog item.

**Scope of this doc:** five workstreams. Each independently shippable.
Like prior phase docs, the spec IS the contract.

The five workstreams (architect-tightened from 4-audit synthesis; 3
items pushed to v1.1, 5 items added for genuine project-close
artifacts):

- **0 — Phase 12 finish-line + critical bug fix + shared primitive.**
  AGENT-PROTOCOL.md namespace reservation (own sub-commit: `fleet.
  services.*` + `fleet.av.*` ROOTED per §8 convention, AVOIDING the
  bare-services collision with OpsHub's `windows.services.*`).
  /api/health critical bug fix — wrap 5 crons in `withLease`
  (alert-escalator, monitor-evaluate, maintenance-window-eval,
  runbook-fire, report-schedules) + rename `"monitor-evaluator"` →
  `"monitor-evaluate"` to match route dir. Phase 12 stragglers:
  `<SavedViewBar>` adoption on /alerts + /devices, `<BulkBar>
  variant="undo">` wire on alerts bulk-ack. `<ExpressionEditor>`
  shared primitive (also retrofits RunbookForm raw-JSON textarea).
  DB migration end-to-end replay test added to CI.
- **A — Agent shell rail + content recording (local disk).**
  pcc2k-agent capability-gating helper (`agent.hello.capabilities`
  reader) — buttons render DISABLED with tooltip when agent doesn't
  advertise `fleet.services` or `fleet.av`. `/api/agent/shell/stream/
  [sessionId]` SSE rail bridging WSS gateway → browser. `Fl_ShellSession`
  gains `recordingPath String?` + `recordingBytes Int?`. Asciicast v2
  written to local disk volume `/var/lib/fleethub/recordings/<id>.cast`
  (NOT S3 — single-server is the v1 deploy model per ROADMAP "Why
  cap at 13" rationale; S3 offload is v1.1). Per-tenant
  `Fl_Tenant.shellRecordingEnabled` (default ON for hipaaMode
  tenants). 🔴 REC indicator in XtermDrawer header. `/recordings/
  [id]` page with `<asciinema-player>` embed (npm dep added BEFORE
  page import per architect §9 footgun). 90d retention sweep cron.
- **B — Tab reorganization + process/service inspector + AV-mutable.**
  Tab reorganization on `/devices/[id]` FIRST (lands BEFORE new tabs
  per architect §9 — otherwise 12-tab interim state on main). Three-
  tier grouping: **Inventory** (Summary / System / Software / Asset
  / Network), **Activity** (Alerts / Patches / Scripts / Services
  / AV / Sessions), **Remote**. New `Fl_ProcessSnapshot { id,
  deviceId, takenBy, takenAt, payloadJson }` — single-row-per-
  operator-click (live-only by default; NO time-series fact table
  to dodge 6M rows/day per architect §4). `fleet.services.list`
  + `fleet.services.start/stop/restart` agent verbs (4-eyes-gated
  via Phase 11 `shouldRequireApproval`; capability-gated UI per
  WS-0). `Fl_AvAction { id, deviceId, verb, target?, state,
  requestedBy, approvedBy?, payloadJson, requestedAt,
  completedAt? }` verb-agnostic schema (architect §9 footgun —
  reviewed BEFORE first verb wires). Verbs: `fleet.av.scan` +
  `fleet.av.update-defs` + `fleet.av.quarantine` + `fleet.av.
  release` (4-eyes on quarantine + release). `/devices/[id]?tab=
  services` + `?tab=av` + fleet-wide "AV actions in flight"
  attention-rail card on /msp.
- **C — Time-tracking + ConnectWise outbound + monitor expressions
  + asset/warranty.** `Fl_RemoteSession.billableMinutes Int? +
  ticketId String? + syncedAt DateTime?` (extend, NOT new
  Fl_TimeEntry table per audit). Server-side accrual ON `endedAt`
  state transition only via `lib/bff-th-client.ts` HMAC outbound
  to TicketHub `/api/inbound/time-entries` (NOT cross-schema
  `$queryRaw` — preserves the audit chain, dedupe on
  `(sourceType, sourceId)`). Same shape on `Fl_ScriptRun`.
  `Fl_Monitor.expressionJson String?` predicate-list shape +
  one level of `{ all: [...], any: [...] }` wrap (NO arithmetic,
  NO variable refs — architect §5 cap). Uses `<ExpressionEditor>`
  from WS-0. `Fl_PsaAdapter { id, tenantName, kind ("connectwise"
  for v1), baseUrl, companyId, credentialId (vault), boardId,
  isActive, lastSyncedAt }` for ConnectWise OUTBOUND only (alert →
  ticket via HMAC); bidirectional ingress = v1.1. `/devices/[id]?
  tab=asset` form (vendor + purchase date + warranty end + serial
  + asset tag + cost). `warranty-90d` report kind. **CUTS** (per
  architect §3): WebAuthn rename UI deferred to v1.1; Deployments
  BulkBar wire deferred to v1.1; "warranty expires in N days"
  StatCard tile deferred to v1.1 (the report kind covers the
  alert need without the decorative tile).
- **D — Mobile MSP + project-close gates + close docs.** Mobile MSP
  card list at `<720px` (CSS-only `@media`, ~120 LOC card-per-
  client showing risk chip + worst-of-three signal). `/api/health`
  returns `{ version: "1.0.0", phase: 13, buildSha }`. Boot-time
  audit-chain self-test verifying the most-recent 1000 rows hash
  forward — **FEATURE-FLAGGED**, default ON via `FLEETHUB_BOOT_
  AUDIT_VERIFY=1`, env override `=0` (architect §9 footgun: a
  hash-chain failure must NEVER refuse boot — surfaces in
  /api/health, logs error, but lets the operator into /admin to
  fix). E2E smoke test in `app/tests/e2e/` (enroll → patch deploy
  → alert fire → runbook fire → ticket open, all green). DB
  migration end-to-end replay test green in CI. `docs/RUNBOOK.md`
  (sourced from `/api/health` + `prisma/schema.prisma` + crontab —
  "if file disagrees, file wins" stamps at section heads).
  `docs/RELEASE-NOTES-v1.0.md` (feature-grouped, operator audience).
  **Added per architect §8**: `docs/CHANGELOG.md` (Phases 0-13
  one-line-per-phase). **Added per architect §10**: `docs/INSTALL.md`
  (1-page first-day-with-FleetHub flow — env vars, first admin
  user, first agent enrollment, smoke-test checklist). `LICENSE`
  at repo root. `package.json` `version=1.0.0` + repository
  metadata. Backup/restore documented + tested once.

**Cross-references:**

- [`PHASE-12-DESIGN.md`](PHASE-12-DESIGN.md) §11 named the "is the
  project actually done?" question as the architect's responsibility.
  Phase 13's architect gut-check answered yes IF WS-0 lands clean,
  the namespace name is resolved before any server code references
  it, the 3 v1.1 cuts are accepted, and the 5 added items ship.
- [`PHASE-12-DESIGN.md`](PHASE-12-DESIGN.md) §11 also called out
  one extra Phase 13 question: "is the project actually done?".
  Section §11 here answers it.
- [`ROADMAP.md`](ROADMAP.md) caps the project at Phase 13. v1.1
  items are operator-driven follow-up; v1.4+ items are non-goals
  (full new project required).
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) §8 namespace table is
  the source-of-truth. WS-0a edits it FIRST (before any server
  code in this phase touches the new verbs).
- [`HIPAA-READY.md`](HIPAA-READY.md) — boot-time audit-chain
  self-test is the natural extension of the verify-chain endpoint.

---

## 1. What Phase 13 ships

**Workstream 0 — Phase 12 finish-line + bug fix + primitive:**

WS-0a (its own commit per architect §1):
- `docs/AGENT-PROTOCOL.md` §8 namespace table edits:
  - `fleet.services.*` (FleetHub-owned, complements OpsHub's
    `windows.services.*` which stays as-is)
  - `fleet.av.*` (FleetHub-owned)
- Cross-repo implication: pcc2k-agent will import these names.
  Doc edit FIRST, server code SECOND, agent ship THIRD.

WS-0b:
- **Critical `/api/health` fix** (architect §4 + §9):
  - Rename `"monitor-evaluator"` → `"monitor-evaluate"` in
    `CRITICAL_CRONS` to match the route dir name.
  - Wrap **5 cron consumers in `withLease`**:
    - `alert-escalator` (90s lease)
    - `monitor-evaluate` (90s lease)
    - `maintenance-window-eval` (90s lease)
    - `runbook-fire` (90s lease)
    - `report-schedules` (300s lease — longer because deliveries
      can take seconds each)
  - Without this, the cron-stale detector is dead-on-arrival for
    every named cron except `network-probe` (Phase 12).
- Phase 12 stragglers:
  - `<SavedViewBar page="alerts">` on `/alerts/page.tsx`.
  - `<SavedViewBar page="devices">` on `/devices/page.tsx`.
  - `<BulkBar variant="undo">` wire on alerts bulk-ack route +
    component (5s auto-clear, reverse acked-at/by via
    `POST /api/alerts/bulk-unack`).
- `<ExpressionEditor>` shared primitive in
  `components/ui/ExpressionEditor.tsx`:
  - Props `{ value, onChange, keyOptions }` where `keyOptions` is
    `Array<{key, ops, valueShape}>`. v1 keys: `exitCode`,
    `stdoutContains`, `stdoutRegex`, `metric`, `op`, `threshold`,
    `forMin`.
  - Outputs the same JSON shape today's `predicateJson` consumes —
    no parser, no AST, no eval.
  - Retrofit `RunbookForm` (currently raw `<textarea>` per UI
    audit §1) in the same PR to prove the primitive.
- DB migration end-to-end replay test added to `app/tests/e2e/
  migration-replay.sh` (drops DB, runs every migration, asserts
  schema matches `prisma db pull`).

**Workstream A — Agent shell rail + content recording:**

- Capability-gating helper in `lib/agent-capabilities.ts`:
  - Read `Op_Agent.capabilitiesJson` (existing column) and expose
    `agentSupports(deviceId, "fleet.shell"|"fleet.av"|"fleet.
    services")` → boolean.
  - Action buttons (`XtermDrawer`, `/devices/[id]?tab=services`
    + `?tab=av`) render DISABLED with tooltip "agent v1.0.1+
    required" when capability missing (NOT 502 on click).
- `/api/agent/shell/stream/[sessionId]` route — SSE rail bridging
  the existing WSS gateway → browser. Bearer-auth via session
  cookie. ChannelId = sessionId. Stream format: SSE `data:`
  events carrying base64'd terminal output bytes.
- `Fl_ShellSession` schema additions:
  - `recordingPath String?` — absolute path on FH server.
  - `recordingBytes Int?` — final byte count, set at close.
- Asciicast v2 writer: as bytes stream through the SSE rail, the
  server also appends to `/var/lib/fleethub/recordings/<sessionId>.cast`
  in asciicast-v2 line-delimited JSON format.
- `Fl_Tenant.shellRecordingEnabled Boolean @default(false)` —
  flipped to `true` by default for HIPAA tenants (per-tenant policy
  in /admin/policies).
- 🔴 REC indicator in `XtermDrawer.tsx` header when
  `session.recordingPath != null`. Also surfaces on portal's
  shell-session-history row as `🔴 recorded` chip.
- `/recordings/[id]/page.tsx` — server-renders an `<asciinema-
  player>` element. Dep `asciinema-player` npm package added in
  the SAME commit per architect §9 footgun (no broken-import-on-
  main window).
- `/api/cron/shell-recording-retain` (daily) — deletes
  `Fl_ShellSession.recordingPath` files older than 90d + nulls
  the path/bytes columns.

**Workstream B — Tab reorganization + process inspector + AV-mutable:**

WS-B.0 — Tab reorganization on `/devices/[id]` (LANDS FIRST per
architect §2):
- Current 9 tabs → 3-tier grouping:
  - **Inventory**: Summary (default), System, Software, Asset
    (WS-C), Network (existing)
  - **Activity**: Alerts, Patches, Scripts, Services (WS-B),
    AV (WS-B), Sessions
  - **Remote**: Remote (consolidated)
- Top-level pill row shows 3 tier names; clicking expands to
  show child tabs. Default deep-link is `?tab=summary`.

WS-B.1 — Process/service inspector:
- `Fl_ProcessSnapshot { id, deviceId, takenBy, takenAt,
  payloadJson }` — JSON blob of the full process/service list
  at click time. NO time-series fact-table (architect §4 — 6M
  rows/day is the architecture-killer).
- New agent verbs:
  - `fleet.services.list` — agent returns full process + service
    inventory.
  - `fleet.services.start` / `fleet.services.stop` /
    `fleet.services.restart` — agent acts on named service.
    4-eyes-gated via `shouldRequireApproval("services.action",
    tenant)` (always gated — destructive).
- `/devices/[id]?tab=services` page:
  - On open: "Snapshot now" button (live-only by default — no
    automatic snapshot on tab visit, dodges 200-row pulls just
    for browsing).
  - After snapshot: paginated list (cursor) of latest snapshot
    rows + fuzzy filter (name / PID / path) + sort by CPU% or
    RAM%. Sticky header.
  - Pin-by-name list saved per device on
    `Fl_StaffUser.savedViewsJson` (Phase 12 — keyed
    `device.processes:<deviceId>`).
  - Action column shows disabled "Start / Stop / Restart" buttons
    by default — operator clicks, request goes through 4-eyes
    via `Fl_ActionApproval`, queued row appears in a
    "Pending actions" StripBar on the page.

WS-B.2 — AV-mutable:
- `Fl_AvAction { id, deviceId, verb (scan / update-defs /
  quarantine / release), target String?, state (queued /
  acked / completed / failed), requestedBy, approvedBy?,
  payloadJson?, requestedAt, completedAt?, errorMsg? }` schema —
  reviewed BEFORE any verb wires (architect §9 footgun: getting
  "verb-agnostic" wrong locks in a v1.1 migration).
- 4-eyes-gated on `quarantine` + `release` (destructive). `scan`
  and `update-defs` audit-only (reversible).
- `/devices/[id]?tab=av` page:
  - Buttons: Run scan, Update definitions, Release from
    quarantine (with file-path input).
  - "Recent AV actions" mini-table below buttons (last 20 for
    this device, state-chipped).
- Fleet-wide "AV actions in flight" attention-rail card on
  /msp — count + warn-tone if any > 15min stuck.

**Workstream C — Time-tracking + ConnectWise + monitor expressions +
asset/warranty:**

- Schema additions:
  - `Fl_RemoteSession.billableMinutes Int?`, `ticketId String?`,
    `syncedAt DateTime?`.
  - `Fl_ScriptRun.billableMinutes Int?`, `ticketId String?`,
    `syncedAt DateTime?`.
  - `Fl_Monitor.expressionJson String?`.
- Time-tracking flow:
  - `closeRemoteSession()` helper (new in `lib/remote-sessions.ts`)
    computes `billableMinutes = (endedAt - startedAt) / 60000`
    on terminal state transition only — NO client-trusted timer
    arithmetic.
  - If `ticketId` set, helper calls
    `callTickethubBff({ path: "/api/inbound/time-entries",
    body: { sourceType: "fleethub-remote", sourceId: session.id,
    minutes, openedAt, closedAt, ticketId, operatorEmail }})`
    via Phase 7 HMAC pattern.
  - TicketHub `/api/inbound/time-entries` (separate ticket-side
    work — flagged as v1.0 cross-app dependency in WS-D close
    docs): inserts `TH_Charge` row, dedupes on
    `(sourceType, sourceId)` UNIQUE.
  - `Fl_RemoteSession.syncedAt` stamped on success.
- "Bill to ticket #" optional input in the existing
  `RemoteSessionLauncher` modal — autocompletes against
  TicketHub `TH_Ticket` via cross-schema `$queryRaw` SELECT
  (read is fine; only writes go via HMAC outbound).
- Custom monitor expressions:
  - `Fl_Monitor.expressionJson` predicate-list shape + one
    level of `{ all: [...], any: [...] }` wrap. Examples:
    `{ all: [{key:"metric", value:"disk.free"}, {key:"op",
    value:"<"}, {key:"threshold", value:10}]}`.
  - Monitor evaluator gets `evaluateComposite()` branch — no
    new parser, just tree-walks the wrap.
  - `<ExpressionEditor>` (WS-0) consumed on `/monitors/new` and
    `/monitors/[id]/edit`.
- ConnectWise outbound:
  - `Fl_PsaAdapter { id, tenantName, kind, baseUrl, companyId,
    credentialId (FK Fl_Credential), boardId, isActive,
    lastSyncedAt }`. v1 only inserts when `kind="connectwise"`.
  - On alert creation (existing `writeAlert` path), if tenant
    has an active PSA adapter row, dispatch outbound HTTP via
    HMAC to the configured baseUrl with the credential's API
    key (resolved via Phase 11 vault).
  - Failures recorded on the Fl_Alert row's existing audit-
    detail field; "Test connection" button on `/clients/[name]?
    tab=settings` Integrations subtab calls a smoke route.
- Asset/warranty:
  - `Fl_Device.assetTag` etc. all exist since posture (Phase 8).
  - `/devices/[id]?tab=asset` form using existing primitives:
    vendor (text), purchase date (date), warranty end (date),
    serial (text, autofill from `inventoryJson.hardware.serial`
    if present), asset tag (text), cost (currency).
  - Server action writes all five.
  - `warranty-90d` report kind: enumerates Fl_Device WHERE
    `warrantyExpiresAt < now() + INTERVAL '90 days'`. Reuses
    existing report-rendering pipeline (Phase 5).

**Workstream D — Mobile MSP + deploy-from-panel + project-close gates + close docs:**

- **Deploy-from-panel** (operator-driven agent enrollment; see
  `~/pcc2k-agent/docs/AGENT-BACKLOG.md` for the agent-side flow):
  - `Fl_EnrollToken { token, tenantName, createdBy, createdAt,
    expiresAt, consumedAt?, consumedByAgentId? }` — one-time
    bootstrap token. 32-byte hex id is the PK; 24h default TTL.
  - `POST /api/admin/enroll-tokens` (withAudit, ADMIN-only):
    body `{ tenantName, ttlHours? }`. Returns `{ token,
    expiresAt, bootstrapSnippetUnix, bootstrapSnippetWindows }`.
  - `POST /api/agent-ingest/enroll` — bootstrap consumer.
    Validates token (unused + unexpired), creates `Op_Agent` +
    secret, marks consumed. Returns
    `{ agentId, agentSecret, fleethubBaseUrl }`. 410-Gone on
    re-use.
  - `GET /install/bootstrap.sh` + `GET /install/bootstrap.ps1` —
    static one-liners served from `~/pcc2k-agent/scripts/`
    (mounted via Next.js public assets or proxy from agent repo
    release tarball).
  - `/clients/[name]?tab=install` page: TTL picker, "Generate
    install command" button, copy-once-revealed snippet. Token
    shown ONCE (similar to Phase 11 recovery-code reveal pattern).
  - Audit verbs: `enroll-token.created`, `enroll-token.consumed`,
    `enroll-token.expired`.
- Mobile MSP:
  - `@media (max-width: 720px)` swap `<table>` for `<ul>` of
    cards: client name + risk chip + worst-of-three signal
    (KEV count OR critical alerts OR offline%).
  - ~120 LOC single component cut.
- `/api/health` returns `{version, phase, buildSha}`:
  - `version: "1.0.0"` (literal).
  - `phase: 13` (literal).
  - `buildSha`: read from env `FLEETHUB_BUILD_SHA` (set at
    container build time). Falls back to `"dev"` if unset.
- Boot-time audit-chain self-test:
  - New `lib/audit-chain-self-test.ts` — verifies most-recent
    1000 `Fl_AuditLog` rows hash forward (no break).
  - Runs on Next.js server startup via instrumentation file.
  - **FEATURE-FLAGGED** per architect §9: default ON via
    `FLEETHUB_BOOT_AUDIT_VERIFY=1`; setting to `0` skips.
  - On break: logs `error`, surfaces in `/api/health.chainOk =
    false`, but DOES NOT refuse to boot. Operator must be able
    to reach /admin to fix.
- E2E smoke test in `app/tests/e2e/`:
  - Single Playwright spec exercising the canonical end-to-end:
    create tenant → enroll agent (mock) → trigger patch deploy
    → alert fires → runbook fires → ticket opens.
  - Green in CI before any v1.0 release tag.
- DB migration end-to-end replay test:
  - `app/tests/e2e/migration-replay.sh` shell script.
  - Drops a temp DB; runs every migration from Phase 0; runs
    `prisma db pull`; diffs the pulled schema against
    `prisma/schema.prisma`. Diff = test fail.
- `docs/RUNBOOK.md` — sourced from:
  - `/api/health` (which crons are critical) → cron-list section.
  - `prisma/schema.prisma` (which `Fl_Tenant.*` flags gate
    features) → tenant-policy reference.
  - `crontab -l` (which routes get hit + cadences) → cron schedule.
  Each section starts: "this section is generated from <file>;
  if it disagrees, the file wins."
  - Also: backup/restore section with a verified restore
    walkthrough done once on a clean VM.
  - Secret-rotation section (FLEETHUB_CRYPTO_ROOT_KEY,
    FLEETHUB_CRON_SECRET, FLEETHUB_AGENT_SECRET, NEXTAUTH_SECRET,
    AZURE_AD_CLIENT_SECRET, PORTAL_BFF_SECRET).
- `docs/RELEASE-NOTES-v1.0.md` — feature-grouped:
  - Six top-level groups: Agent + Monitoring, Operator Workflows,
    Reporting, Compliance + Security, Integrations, Project
    Infrastructure.
  - Each group bullets the features added across all phases
    that landed in it. Audience: operator (Mike), with one
    paragraph at top for end-customer-facing capability summary.
- `docs/CHANGELOG.md` — phase-stamp one-liner per phase 0-13.
  Single source of "what changed between major versions" doc
  for future-you / v1.1 contributor.
- `docs/INSTALL.md` — 1-page first-day flow:
  - Env vars required (with .env.example pointer).
  - First admin user (seed script).
  - First agent enrollment (5 commands).
  - Smoke-test checklist (visit /, /devices, /alerts, run
    `/api/health`, verify chainOk=true).
- `LICENSE` at repo root.
- `package.json` `version: "1.0.0"`, `description`,
  `repository.url`.

---

## 2. Schema deltas

**All additions pure-additive. No DROP. No NOT NULL on existing
columns. DB backup BEFORE DDL apply.**

New tables (4):
- `Fl_ProcessSnapshot` (single-row-per-operator-click; no time-series)
- `Fl_AvAction` (verb-agnostic; reviewed-shape per architect §9)
- `Fl_PsaAdapter` (ConnectWise outbound config)
- `Fl_EnrollToken` (one-time agent bootstrap token; deploy-from-panel)

New columns:
- `Fl_ShellSession`: `recordingPath String?`, `recordingBytes Int?`
- `Fl_RemoteSession`: `billableMinutes Int?`, `ticketId String?`, `syncedAt DateTime?`
- `Fl_ScriptRun`: `billableMinutes Int?`, `ticketId String?`, `syncedAt DateTime?`
- `Fl_Monitor`: `expressionJson String?`
- `Fl_Tenant`: `shellRecordingEnabled Boolean @default(false)`

---

## 3. Hard ordering (§5) — 15 footguns

The architect's gut-check + audit synthesis surfaced 15 footguns.
Phase 13 sequences around them:

1. **AGENT-PROTOCOL.md namespace edit FIRST** (WS-0a, own commit).
   Cross-repo implications — pcc2k-agent will import these names.
   Names must be ROOTED: `fleet.services.*` + `fleet.av.*`
   (architect §1 catch — bare `services.*` would collide with
   OpsHub's `windows.services.*`).
2. **CRITICAL_CRONS rename + 5 lease wraps SECOND** (WS-0b).
   `/api/health` cron-stale detector is dead-on-arrival without
   this fix. Lands before any new feature work.
3. **ExpressionEditor primitive BEFORE WS-C monitor expressions.**
   Retrofits RunbookForm raw-JSON textarea in same PR (audit §1
   "fix two with one").
4. **Capability-gating helper BEFORE WS-A + WS-B action buttons.**
   Buttons must render DISABLED with tooltip when agent doesn't
   advertise capability — NOT 502 on click.
5. **asciinema-player npm dep BEFORE /recordings/[id] page import**
   (architect §9 — no broken-import-on-main window).
6. **Tab reorganization (WS-B.0) BEFORE new tabs land**
   (architect §2 — otherwise 12-tab interim state on main).
7. **pcc2k-agent verbs BEFORE content-recording wire is hot.**
   FH-side gracefully degrades when agent lacks capability —
   shell.open button disabled, recording column null. Agent ships
   in v1.0.1 (architect §5).
8. **lib/bff-th-client.ts HMAC outbound pattern proven BEFORE
   TicketHub time-card sync.** Cross-schema $queryRaw write
   would break the audit chain (architect §3).
9. **4-eyes gate on `fleet.services.start/stop/restart` +
   `fleet.av.quarantine/release` BEFORE buttons render.**
   `scan` + `update-defs` are audit-only (reversible).
10. **Fl_AvAction verb-agnostic schema reviewed BEFORE first verb
    wires** (architect §9 — verb-agnostic locks in once one verb
    writes a row).
11. **Boot-time audit-chain self-test feature-flagged**
    (architect §9 — env `FLEETHUB_BOOT_AUDIT_VERIFY=0` skips;
    failure NEVER refuses boot, only surfaces in /api/health).
12. **DB migration end-to-end replay test green BEFORE
    RELEASE-NOTES commit** (architect §7e).
13. **/api/health returns `version` + `phase` + `buildSha` BEFORE
    RELEASE-NOTES references it** (the docs cite the endpoint).
14. **RUNBOOK + RELEASE-NOTES + CHANGELOG + INSTALL + LICENSE +
    package.json version=1.0.0 LAST** (the project-close artifacts;
    everything else must be done first).
15. **Phase 12 stragglers (saved-views adoption + Alerts bulk-ack
    undo wire) complete in WS-0 BEFORE WS-A/B/C UI work piles on**
    (otherwise the wires drift into the close commits).

---

## 4. Migrations + activation checklist

- [ ] DB backup (`pg_dump`) to `backup-dochub-pre-phase13-YYYYMMDD-
  HHMMSS.sql` immediately before DDL apply.
- [ ] Apply `migrations/phase-13.sql` (3 new tables + 9 new
  columns). Verify table count 45→48.
- [ ] Set `FLEETHUB_BUILD_SHA` env var in container build (git rev-
  parse HEAD; defaults to "dev" when unset).
- [ ] Set `FLEETHUB_BOOT_AUDIT_VERIFY=1` (default on) — env
  override `=0` to skip if a legitimate edit needs operator
  recovery time.
- [ ] Add 1 new cron to crontab: `0 4 * * * curl ...
  /api/cron/shell-recording-retain` (daily 4am).
- [ ] Operator: pcc2k-agent ships v1.0.1 with `fleet.services.*`
  + `fleet.av.*` verbs (out-of-repo work — tracked as v1.0 close
  cross-repo gate but doesn't block FH-side close).
- [ ] Operator: TicketHub ships `/api/inbound/time-entries`
  endpoint that accepts HMAC outbound + dedupes on
  `(sourceType, sourceId)` UNIQUE (cross-app gate).
- [ ] Per-tenant: flip `shellRecordingEnabled=true` on HIPAA
  tenants via `/admin/policies`.
- [ ] Per-tenant (optional): create `Fl_PsaAdapter` row for
  ConnectWise customers.

---

## 5. v1.1 territory (architect-confirmed cuts)

After Phase 13 ships, v1.0 is released. v1.1 is operator-driven
follow-up release, NOT Phase 14. Items moved here:

- **S3 recording offload** (single-server is the v1 deploy model
  per ROADMAP "Why cap at 13" rationale)
- **Bidirectional ConnectWise** (ingress webhook receiver — own
  pass for retry semantics + idempotency)
- **Multi-metric monitor expressions DSL** (current predicate +
  all/any wrap is enough for v1)
- **SSE rail cards** (Next.js long-lived conns + reconnect UX =
  own pass)
- **Full process-telemetry time-series** (snapshot-on-click is
  the v1 answer)
- **WebAuthn cred rename UI** (cut to v1.1 — adornment per
  architect §3)
- **Deployments BulkBar wire** (cut to v1.1 — 4th BulkBar copy
  promotion proof, ship when called for)
- **"Warranty expires in N days" StatCard tile** (cut to v1.1 —
  decorative; the `warranty-90d` report kind covers the alerting
  need)

---

## 6. Out-of-scope at project close (Phase 14+ ideas only)

These declared non-goals at project close. Becoming important
means a new project, not a backlog item:

- HSM / KMS integration
- Multi-region key replication
- CMDB / device-depends-on-device graph
- AI alert correlation / root-cause clustering
- White-label / multi-MSP federation
- PWA-native mobile
- Halo + Autotask PSA adapters
- Risk-weight tuning UI on /msp
- Per-tenant compliance weight override
- 7-day sparkline per signal on triage table

---

## 7. Test gates

- `npm run typecheck` clean.
- `npx vitest run` — must include new test files plus 212 pass:
  - `tests/expression-editor.test.ts` (predicate-list serialization,
    all/any wrap, primitives roundtrip)
  - `tests/audit-chain-self-test.test.ts` (chain-walk over fixture
    rows, break detection, feature-flag respect)
  - `tests/process-snapshot.test.ts` (snapshot serialization)
  - `tests/av-action.test.ts` (verb-agnostic state transitions)
- `npx playwright test` — E2E smoke spec PLUS:
  - `/recordings/[id]` page renders asciinema-player.
  - `/devices/[id]?tab=services` snapshot + filter.
  - Mobile MSP card layout at 720px viewport.
- DB migration end-to-end replay test green in CI.
- Manual: full Phase-13 smoke against a real agent (v1.0.1)
  before v1.0 tag.
- Manual: backup → restore on a clean VM (documented in RUNBOOK).

---

## 8. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Namespace name collision with OpsHub `windows.services.*` | high | Architect §1: namespace must be rooted `fleet.services.*` + `fleet.av.*`. AGENT-PROTOCOL edit lands FIRST per §3.1. |
| Cron-stale detector silently broken for 3 of 4 named crons | high | WS-0b fixes 5 wraps + rename. Critical bug — Phase 12 design declared this working but it was dead-on-arrival. |
| Audit chain leaked through cross-schema raw write to TicketHub | high | WS-C uses lib/bff-th-client.ts HMAC pattern. Architect §3 caught this — raw write breaks audit chain story. |
| pcc2k-agent v1.0.1 not ready at v1.0 release | medium | Capability-gated buttons render DISABLED, not 502. UI ready, agent ships v1.0.1. Architect §5 says acceptable. |
| Process inspector ingests 6M rows/day → DB death | medium | Snapshot-only, single-row-per-click. NO time-series fact table. Architect §4. |
| Custom expressions become an eval-injection DSL | medium | Capped at predicate + one level all/any. NO arithmetic, NO variables. Architect §5. |
| Boot-time audit-chain self-test refuses boot on legitimate operator DB edits | medium | Feature-flagged with env override. Failure logs + surfaces in /api/health, never refuses boot. Architect §9. |
| asciinema-player import lands before dep install | low | Architect §9 — dep added in same commit as page import. |
| Tab reorganization creates 12-tab interim on main | low | WS-B.0 reorg lands BEFORE new tabs (services/av/asset). Architect §2. |
| RUNBOOK drifts on day 1 | medium | "If file disagrees, the file wins" stamps + sourced from health/schema/crontab. Architect §7. |

---

## 9. Sequencing summary

```
WS-0a docs/AGENT-PROTOCOL.md namespace edit (own commit, FIRST)

WS-0b.1 lib/agent-capabilities.ts capability helper
WS-0b.2 /api/health CRITICAL_CRONS rename + 5 lease wraps
WS-0b.3 SavedViewBar on /alerts + /devices
WS-0b.4 BulkBar variant="undo" wire on alerts bulk-ack
WS-0b.5 ExpressionEditor primitive + RunbookForm retrofit
WS-0b.6 app/tests/e2e/migration-replay.sh

WS-B.0 /devices/[id] tab reorganization (3-tier grouping)

WS-A.1 Fl_ShellSession.recordingPath/Bytes + Fl_Tenant.shellRecordingEnabled
WS-A.2 asciinema-player npm dep + /recordings/[id]/page.tsx
WS-A.3 /api/agent/shell/stream/[sessionId] SSE rail
WS-A.4 Asciicast v2 writer + XtermDrawer 🔴 indicator
WS-A.5 /api/cron/shell-recording-retain (90d sweep)

WS-B.1 Fl_ProcessSnapshot schema + fleet.services.list + /devices/[id]?tab=services
WS-B.2 fleet.services.start/stop/restart 4-eyes-gated buttons
WS-B.3 Fl_AvAction verb-agnostic schema (reviewed-first commit)
WS-B.4 fleet.av.scan/update-defs/quarantine/release routes
WS-B.5 /devices/[id]?tab=av + fleet-wide AV rail card

WS-C.1 Fl_RemoteSession + Fl_ScriptRun schema additions
WS-C.2 closeRemoteSession() helper via lib/bff-th-client HMAC
WS-C.3 Fl_Monitor.expressionJson + ExpressionEditor consumer
WS-C.4 Fl_PsaAdapter schema + ConnectWise outbound dispatcher
WS-C.5 /devices/[id]?tab=asset form + warranty-90d report kind

WS-D.0 Fl_EnrollToken schema + /api/admin/enroll-tokens + /api/agent-ingest/enroll + /install/bootstrap.{sh,ps1} + /clients/[name]?tab=install page (deploy-from-panel)
WS-D.1 Mobile MSP card list @media query
WS-D.2 /api/health returns {version, phase, buildSha} + chainOk
WS-D.3 lib/audit-chain-self-test.ts + instrumentation hook
WS-D.4 app/tests/e2e/ smoke (enroll→patch→alert→runbook→ticket)
WS-D.5 docs/RUNBOOK.md
WS-D.6 docs/RELEASE-NOTES-v1.0.md
WS-D.7 docs/CHANGELOG.md (phases 0-13)
WS-D.8 docs/INSTALL.md + LICENSE + package.json version=1.0.0
```

Total expected commits: **18-22** (architect target after cuts).

---

## 10. Out-of-scope deliberate non-goals (close-doc declarations)

These get one-line shoutouts in `docs/RELEASE-NOTES-v1.0.md` and
`docs/RUNBOOK.md` "future work" sections so operators know they're
intentional non-goals, not gaps:

- HSM / KMS integration (single-server deploy is the model)
- Multi-region key replication
- CMDB / device-depends-on-device graph
- AI alert correlation / root-cause clustering
- White-label / multi-MSP federation
- PWA-native mobile (responsive web is the answer)
- Halo + Autotask PSA adapters (ConnectWise covers demand)
- Risk-weight tuning UI on /msp (MSP triage shipped functional
  in Phase 6)
- Per-tenant compliance weight override
- 7-day sparkline per signal on triage table

---

## 11. Why this phase, why these workstreams — and IS the project done?

The ROADMAP committed to closing the project at Phase 13. Phase 13's
job is consuming the operations-and-integrations backlog that fits
the "final polish + project close" framing, while explicitly
declaring everything else as either v1.1 follow-up OR Phase 14+
non-goal.

The architect's gut-check answered the load-bearing question from
PHASE-12-DESIGN §11:

> Is the project actually done after Phase 13?

**Honest answer (architect §10): YES, IF**

1. WS-0 lands clean (Phase 12 critical health bug fixed; namespace
   resolved before any server code references it).
2. The 3 v1.1 cuts are accepted (WebAuthn rename, Deployments
   BulkBar, warranty StatCard tile).
3. The 5 added project-close items ship (INSTALL.md, LICENSE,
   package.json version=1.0.0, CHANGELOG.md, backup/restore
   documented + tested).
4. The 4 close-gates fire green (lease-wire complete, AGENT-
   PROTOCOL edit committed before server code, /api/health
   returns version/phase/buildSha, E2E smoke green).

The architect's gut-check said: "Phase 13 as scoped + the cuts =
yes." Two genuine gaps surfaced that aren't in the ROADMAP v1.1
list and that PHASE-13 DESIGN.md adds to scope:

- **`docs/INSTALL.md` — the operator-onboarding gap.** RUNBOOK is
  runtime; RELEASE-NOTES is marketing. A 1-page first-day flow is
  the difference between "demo-able" and "shippable to an operator
  who isn't you."
- **`LICENSE` + `package.json` version=1.0.0 + repository
  metadata.** Trivial but a v1.0 without these is not actually
  released.

Both ship in WS-D.

The cap-at-Phase-13 commitment survives.

---

**End of design.**
