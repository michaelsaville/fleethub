# FleetHub Phase 12 — Operations Expansion (Design)

**Status:** Draft, 2026-05-18. Not yet implemented. Phase 12 is the
**operations expansion** phase — the items that share a coherent
"expand what FleetHub can monitor + act on + recover from" framing,
deliberately distinct from Phase 11's crypto bundle. Second-to-last
phase. Phase 13 closes the project per `docs/ROADMAP.md`.

**Scope of this doc:** five workstreams. Like prior phases, each is
independently shippable. Like prior phase docs, the spec IS the
contract.

The five workstreams (architect-tightened from 4-audit synthesis;
3 items pushed to Phase 13 to keep Phase 12 ship-able in one sweep):

- **A — Network device monitoring (SNMP v3 + ICMP).** New full-stack
  noun. `Fl_NetworkDevice` (kind enum, snmpVersion, snmpCredentialId
  →Fl_Credential, icmpEnabled, pollIntervalSec) + `Fl_NetworkProbe`
  fact-table + `Fl_NetworkProbeHour` materialized rollup (not a view
  — Phase 6 hit the rescan bug). `/api/cron/network-probe` 30s
  cadence with per-device pollIntervalSec gating. `/api/cron/network-
  probe-rollup` hourly. `/api/cron/network-probe-retain` daily 90d
  sweep (ships BEFORE the probe cron per §5.2). SNMP creds resolved
  via Phase 11 vault. `/network-devices` list + `/network-devices/
  [id]` detail with sparkline from rollup. Fires `network.down` +
  `network.latency` via existing `writeAlert()`. New
  `<StatusDot>` primitive extracted in the same PR (3rd inline copy
  was about to land here).
- **B — Recurring maintenance windows.** Single noun (architect cut
  AV-mutable out and bundled to Phase 13 with the namespace
  decision). `Fl_MaintenanceWindow { tenantName, name, cron string,
  durationMin, suppressAlertKindsJson, scopeJson, nextStart,
  nextEnd, createdBy, createdAt }` + `/api/cron/maintenance-window-
  eval` (1m) that flips `Fl_Device.maintenanceMode` per matching
  window — reuses Phase 3's maintenance plumbing (no new suppression
  code path). Editor reuses the `OncallScheduleForm` weekly-slot
  pattern with tenant-timezone preview. `/admin/policies` Maintenance
  subtab.
- **C — Vault-KEK rotation UI + Phase-11 follow-ups.** `/admin/
  crypto/rotate` 3-step wizard: (1) pre-flight count of credentials
  + last rotation date + current key fingerprint via `MaskedField`,
  (2) `ConfirmModal` with `typedName="rotate vault-kek"` gate +
  step-up token requirement, (3) background rewrap with progress
  polling. Companion `deriveTenantDekForVersion(tenant, v)` so
  rewrap can decrypt v1 then re-encrypt v2 (closes the Phase-11
  §3 explicit throw). Row-level `SELECT FOR UPDATE` on each
  `Fl_Credential` to race-safely block disclose during rewrap.
  Bundled Phase-11 follow-ups: (a) `migrate-channel-secrets-to-
  vault.ts` extending the Slack migration to SMTP-password,
  PagerDuty integration-key, Teams-webhook entries in
  `Fl_AlertRoute.channelsJson`; (b) `/api/cron/approval-expiry-
  sweep` (1h) transitions `Fl_ActionApproval` from `pending` to
  `expired` past expiresAt + purges `Fl_StepUpConsumed` past expMs.
- **D — Operator power tools.** Five shipped here:
  - **xterm.js drawer terminal** on /devices/[id]?tab=remote.
    Right-side slide-in drawer at `max(720px, 60vw)` width, full
    height. Wired to existing Fl_ShellSession via SSE. Dynamic
    import (xterm bundle is ~80KB; lazy-load it). Close-X means
    DISCONNECT, not hide — calls POST close endpoint first, then
    unmounts after 200.
  - **Saved views** on /alerts + /devices. `<SavedViewBar>`
    primitive uses Phase 11's `<Chip interactive active>`. Persists
    to `Fl_StaffUser.savedViewsJson` with `{v: 1, views: [{id,
    name, filters, columnOrder, columnVis, sort}]}` envelope (zod
    safeParse on read, drop-unknown-version-and-re-save).
    `GET/PUT /api/account/saved-views`.
  - **Deployments BulkBar + Alerts bulk-ack Undo toast.** New
    `<BulkBar>` primitive (promoted from AlertsTable + DeviceTable
    hand-rolls — 4th copy was about to land here). Migrate both
    existing call-sites in the same PR. Deployments BulkBar
    actions: pause/resume/abort N. Undo toast = 5s reverse window
    on `Fl_Alert.ackedAt`/`ackedBy`.
  - **Sidebar `/approvals` link + NotificationBadge wire.** Delete
    Sidebar's hand-rolled inline-badge first; then wire to the
    Phase 11 `NotificationBadge` primitive. 30s SWR polling on
    `GET /api/approvals?count=1` returning `{count}` only.
- **E — Hardening.** Five shipped here:
  - **`lib/cron-fire-eval.ts` extraction.** Single source for "is
    this cron due now" + idempotent `bumpLastFired`. Migrate
    `report-schedule.ts` in the same PR as proof. Six future cron
    consumers compose, not fork.
  - **`Fl_EvaluatorLease` table for queue throttling.** Atomic
    `INSERT...ON CONFLICT DO UPDATE WHERE leasedUntil < now()
    RETURNING name` — no Redis dep, survives restart, serves
    cron-stale detector AND throttling from one table.
  - **DST-aware on-call.** `@date-fns/tz` dep (~12KB; vs Luxon's
    ~70KB). `Fl_OncallSchedule.timezone` IANA column. Replace
    `at.getUTCDay/Hours` with `formatInTimeZone(at, sched.timezone,
    "e HH:mm")`. 4 vitest cases: DST-forward, DST-back, Arizona,
    Hawaii.
  - **`submitWithApproval()` client helper.** Returns discriminated
    union `{ok} | {approval, id} | {err}`. Migrates the 2 existing
    BulkBars + credential disclose modal in the same PR — they
    don't inspect status today (silent-success bug).
  - **Health endpoint widening.** `/api/health` returns
    `cronLastSeenAt` per cron (from `Fl_EvaluatorLease`). Returns
    503 if oldest critical cron is >15min stale. Operator crontab
    probes `/api/health` with the secret as a synthetic cron;
    alerts on 401 — catches `FLEETHUB_CRON_SECRET` drift that
    Phase 11 WS-E.7 left silent-detectable.

**Cross-references:**

- [`PHASE-11-DESIGN.md`](PHASE-11-DESIGN.md) §7 named maintenance
  windows + AV-mutable as Phase 12 candidates. Phase 12's
  architect gut-check moved AV-mutable to Phase 13 — see §13 below.
- [`ROADMAP.md`](ROADMAP.md) caps project at Phase 13. Phase 12's
  scope is the architect-tightened middle slice; Phase 13 absorbs
  the agent-namespace bundle (`fleet.av.*` + `fleet.services.*`)
  + final polish.
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) — Phase 12 introduces
  ZERO new agent verbs (network probes are FH-server-side via
  net-snmp + node ICMP). The pcc2k-agent Go verbs for
  shell/file/backup were FH-side-shipped in Phase 10 + 11; Phase 12
  ships the Go-side handlers (out-of-repo work tracked as exit-gate).
- [`HIPAA-READY.md`](HIPAA-READY.md) — WS-C rotation UI gates on
  step-up (Phase 11) + 4-eyes approval (Phase 11). Maintenance
  windows alert-suppression has its own audit verb.

---

## 1. What Phase 12 ships

Concretely, by the end of each workstream:

**Workstream A — Network device monitoring:**

- New Prisma models:
  - `Fl_NetworkDevice { id, clientName, displayName, ipAddress,
    kind enum, snmpVersion enum(none/v2c/v3), snmpCredentialId? FK→
    Fl_Credential, icmpEnabled Boolean @default(true),
    pollIntervalSec Int @default(60), tagsJson?, isActive Boolean,
    createdBy, createdAt, updatedAt }`. Kind: switch / router /
    firewall / ap / printer / ups / other.
  - `Fl_NetworkProbe { id, networkDeviceId FK, ts, kind enum(icmp/
    snmp-get/snmp-walk), rttMs Float?, ok Boolean, errorMsg?,
    payloadJson? }`. Append-only. Index `(networkDeviceId, ts DESC)`.
  - `Fl_NetworkProbeHour { networkDeviceId, hour, p50Ms, p95Ms,
    p99Ms, lossPct, sampleCount }`. Composite PK `(networkDeviceId,
    hour)`. Populated by `network-probe-rollup` cron, NOT a view.
- New crons (all use `lib/cron-fire-eval.ts` from WS-E):
  - `/api/cron/network-probe` 30s cadence. Iterates active
    `Fl_NetworkDevice` rows; per device, gates on `lastProbedAt +
    pollIntervalSec`. Fires ICMP via node-icmp (or fallback shell
    `ping`); fires SNMP via `net-snmp` lib with vault-resolved
    creds. Writes `Fl_NetworkProbe` row. Triggers `network.down`
    alert on consecutive-failure threshold; `network.latency` on
    p95 over per-device threshold.
  - `/api/cron/network-probe-rollup` hourly. Aggregates last hour
    of `Fl_NetworkProbe` into `Fl_NetworkProbeHour` per device.
  - `/api/cron/network-probe-retain` daily. Deletes
    `Fl_NetworkProbe` rows older than 90 days. **Ships BEFORE
    the probe cron lands per §5.2 footgun.**
- `/network-devices` list page using new `<DataTable>` (Phase 11
  WS-E.1) + `<StatusDot>` (NEW primitive, see UI §6). Columns:
  host, kind, IP, status, last probed, p95 ms (24h from rollup).
- `/network-devices/[id]` detail with last-24h sparkline rendered
  from `Fl_NetworkProbeHour` (24 hourly rows max).
- `/network-devices/new` form. Manual add only in v1; auto-discover
  via SNMP walk is Phase 14+ idea.
- Per-tenant `Fl_Tenant.netmonEnabled` toggle in `/admin/policies`
  Network subtab + TenantSettingsTab.

**Workstream B — Recurring maintenance windows:**

- New Prisma model:
  - `Fl_MaintenanceWindow { id, tenantName, name, cron string,
    durationMin Int, suppressAlertKindsJson?, scopeJson? (
    deviceTags or deviceGroupId), nextStart DateTime?, nextEnd
    DateTime?, createdBy, createdAt, updatedAt }`. cron is RRULE-
    style ("every Sunday 02:00") — operators want recurring shape,
    not 52 rows.
- `/api/cron/maintenance-window-eval` (1m, uses
  `lib/cron-fire-eval.ts`). Per window:
  - Compute next fire time relative to lastFired (cron-parser w/
    tenant tz).
  - If `now ∈ [nextStart, nextStart + durationMin]`:
    - Flip every device in scope to `maintenanceMode=true` (Phase 3
      plumbing) with `maintenanceUntil=nextEnd`.
    - Apply `suppressAlertKindsJson` to active alerts (mark
      `state="suppressed"` for the kinds named).
  - Audit each transition via `withAudit({action:
    "maintenance-window.fire"})`.
- Editor: `MaintenanceWindowForm.tsx` cloned-and-adapted from
  `OncallScheduleForm.tsx` (weekly day×time-slot pattern). Tenant
  tz preview reuses the Phase 10 `<TzPreview>` helper.
- `/admin/policies` Maintenance subtab listing all windows
  across tenants + create / edit / delete.
- Per-tenant access via TenantSettingsTab.

**Workstream C — Vault-KEK rotation UI + Phase-11 follow-ups:**

- New `lib/credential-vault.ts` exports:
  - `deriveTenantDekForVersion(tenantName, version)`: takes
    explicit version, loads `Fl_CryptoKey` row at that version
    (active OR retired), unwraps via root key, derives DEK. Mirror
    of `deriveTenantDek` but version-agnostic.
  - `rewrapTenantCredentials({ tenantName, fromVersion, toVersion,
    onProgress })`: streams over per-tenant credentials in
    batches of 100. Each batch: `prisma.$transaction([
    SELECT FOR UPDATE → decrypt with old DEK → encrypt with new
    DEK → UPDATE ciphertext + nonce + keyVersion ])`. Yields
    progress { processed, total, currentTenant }.
- `/admin/crypto` page lists `Fl_CryptoKey` rows (all purposes,
  version + createdAt + retiredAt + algorithm). Rotate button per
  active row.
- `/admin/crypto/rotate?purpose=vault-kek` 3-step wizard:
  1. **Pre-flight.** Loads `Fl_CryptoKey` active row → renders
     fingerprint via `<MaskedField>`. Counts affected credentials
     per tenant. "Rotation typically takes ~N seconds where N =
     credential count / 50".
  2. **Confirm.** `<ConfirmModal typedName="rotate vault-kek"
     stepUpRequired>`. Step-up token consumed via existing
     `consumeStepUp` from Phase 11. **NOT** 4-eyes-gated in v1
     (single-admin op; if HIPAA requires it later, wire via
     `requireApproval` per existing pattern).
  3. **Progress.** POSTs `/api/admin/crypto/rotate` which returns
     `{ rotationId }` immediately; background job runs
     `rewrapTenantCredentials` per tenant. Page polls
     `GET /api/admin/crypto/rotate/[id]` every 1s for `{processed,
     total, state, currentTenant}`. New `Fl_CryptoRotation { id,
     purpose, fromVersion, toVersion, state, processed, total,
     startedAt, completedAt? }` table.
  4. Done state: renders new fingerprint via `<MaskedField>`.
     Audit row `crypto.key.rotated` written.
- `Fl_CryptoRotation` schema additive.
- Loud red banner on `/admin/crypto/*` when a rotation is
  `in-progress` (only one concurrent rotation; second attempt
  blocked).
- `scripts/migrate-channel-secrets-to-vault.ts` extends Phase 11's
  Slack migration to: SMTP passwords (in `Fl_AlertRoute.
  channelsJson` for email entries), PagerDuty `integrationKey`,
  Teams webhook URLs. Same idempotent dry-run/apply shape; same
  audit rows.
- `/api/cron/approval-expiry-sweep` (1h, uses
  `lib/cron-fire-eval.ts`):
  - `Fl_ActionApproval` WHERE state='pending' AND expiresAt <
    now() → state='expired' (audit `approval.expired`).
  - `Fl_StepUpConsumed` WHERE expMs < now() → DELETE (no audit
    needed; replay-guard ledger only).

**Workstream D — Operator power tools:**

- `<StatusDot>` primitive (`components/ui/StatusDot.tsx`): props
  `{ tone: "ok"|"muted"|"warn"|"danger", size?, label? }`. Default
  7px. Migrates DeviceTable + clients/[name] inline copies in the
  same PR (architect: extract BEFORE /network-devices ships the 3rd
  copy).
- `<BulkBar>` primitive (`components/ui/BulkBar.tsx`): props
  `{ count, summary?, actions: ReactNode[], onClear }`. Sticky-
  bottom, 10px radius, accent-on-confirm, danger-on-destructive.
  Migrates AlertsTable + DeviceTable hand-rolls in the same PR.
  Deployments BulkBar consumes it natively. Undo-toast slot is a
  variant: `<BulkBar variant="undo" autoclear={5000}>`.
- `<XtermDrawer>` (`components/XtermDrawer.tsx`): client component,
  right-side slide-in, `max(720px, 60vw)` width. Dynamic-imports
  `xterm` + `xterm-addon-fit`. Header: hostname + duration counter
  + close-X + ESC-binding. Close-X calls `POST /api/admin/shell-
  sessions/[id]/close` first; modal stays open showing
  "Disconnecting…" until 200, then unmounts. Confirm if scrolled-
  away output exists. WSS transport to agent via existing Phase 10
  shell-session ingest plumbing.
- `<SavedViewBar>` (`components/ui/SavedViewBar.tsx`): renders
  saved views as `<Chip interactive active>` row above filter
  strip. Trailing `<Button size="xs" variant="ghost">+ save current
  as…</Button>`. `/alerts` + `/devices` adopt.
  - `Fl_StaffUser.savedViewsJson` envelope: `{ v: 1, views:
    [{ id, name, page: "alerts"|"devices", filters: Record<string,
    string>, columnOrder?: string[], columnVis?: Record<string,
    boolean>, sort?: { col: string, dir: "asc"|"desc" } }] }`.
    zod safeParse on read, drop-unknown-version-and-re-save.
  - `GET /api/account/saved-views` returns parsed array.
  - `PUT /api/account/saved-views` body `{ view }` merges by id.
  - `DELETE /api/account/saved-views/[id]` removes.
- Deployments BulkBar wires:
  - Multi-select on `/deployments` (existing list page).
  - `<BulkBar>` actions: pause / resume / abort N.
  - New `POST /api/deployments/bulk` accepts `{ ids, action }`.
  - 4-eyes-gated when N > tenant bulkApprovalThreshold (Phase 11).
- Alerts bulk-ack Undo toast:
  - On successful bulk-ack, render toast bottom-left "N alerts
    acked. [Undo]". 5s timer. Undo POSTs `/api/alerts/bulk-unack`
    with the original ids list — sets `ackedAt=null` + `ackedBy=
    null` only if the row is still `state="ack"` (race-safe).
- Sidebar `/approvals` link with `<NotificationBadge>`:
  - Delete the Sidebar's hand-rolled inline-badge (lines 124-135).
  - Add Approvals to NAV_ITEMS with `<NotificationBadge count={...}
    tone="warn">`.
  - `AppShell.tsx` fetches pending count via SWR-poll (30s) on
    `GET /api/approvals?count=1` (new query mode; returns `{count}`
    only, no list).

**Workstream E — Hardening:**

- `lib/cron-fire-eval.ts`: pure helper for cron-due evaluation.
  Exports `findDue<T>(rows, getCron, getLastFired, now, tz?):
  T[]` + `bumpLastFired(rowId, fireTime, error?): Promise<void>`.
  Migrate `lib/report-schedule.ts` in the same PR. Phase 12's new
  crons (network-probe + maintenance-window-eval +
  network-probe-rollup + network-probe-retain + approval-expiry-
  sweep) all compose.
- `Fl_EvaluatorLease { name @id, leasedAt, leasedUntil, leasedBy,
  heartbeatAt }`. Atomic `INSERT...ON CONFLICT DO UPDATE WHERE
  leasedUntil < now() RETURNING name`. Wrap as `withLease(name,
  ttlMs)`. Compose AFTER `withCronAuth` so 401 is still checked.
  Also serves as cron-stale detector for the health endpoint.
- `@date-fns/tz` dep (~12KB; Luxon ruled out as ~70KB + parallel
  date stack). `Fl_OncallSchedule.timezone` IANA column (additive).
  `lib/oncall.ts` migrates `at.getUTCDay/Hours` →
  `formatInTimeZone(at, sched.timezone || "UTC", "e HH:mm")`. 4
  vitest cases: DST-forward (US Eastern), DST-back, Arizona (no
  DST), Hawaii (UTC-10 no DST).
- `lib/client/submit-with-approval.ts` (Phase 11 follow-up):
  ```ts
  export async function submitWithApproval(
    url: string, body: unknown
  ): Promise<{ok: true, json: unknown}
            | {approval: true, approvalId: string, reason?: string}
            | {error: string, status: number}>
  ```
  Inspects 202 + `{status: "approval-required"}` shape.
  Migrate 3 existing call-sites: AlertsTable.onBulkAck,
  DeviceTable BulkBar submit, credential disclose modal.
- `/api/health` widening: select `name, leasedAt, leasedUntil,
  heartbeatAt` from `Fl_EvaluatorLease`. Compute `cronLastSeenAt
  = max(heartbeatAt)` per name. Return 503 if any cron in a
  curated `CRITICAL_CRONS` set is stale > 15min. Existing DB-
  connectivity check preserved.

---

## 2. Schema deltas

**All pure-additive. No DROP. No NOT NULL on existing columns. No
column renames. DB backup BEFORE `prisma db push` / DDL apply.**

New tables (6):
- `Fl_NetworkDevice`
- `Fl_NetworkProbe`
- `Fl_NetworkProbeHour` (materialized rollup; PK composite)
- `Fl_MaintenanceWindow`
- `Fl_CryptoRotation`
- `Fl_EvaluatorLease`

New columns:
- `Fl_OncallSchedule.timezone String?` (IANA, e.g. "America/New_York")
- `Fl_Tenant.netmonEnabled Boolean @default(false)`

---

## 3. Hard ordering (§5)

The architect's gut-check + audit synthesis surfaced 11 footguns.
The phase sequences around them:

1. **`Fl_EvaluatorLease` table FIRST.** Cron-fire-eval extraction
   needs the lease primitive to compose with — if extraction lands
   first, all 6 cron consumers get rewritten twice.
2. **`network-probe-retain` cron BEFORE `network-probe` cron lands
   live.** Without the 90d sweep in place at launch, month-3 is
   when ops notice the row-count balloon.
3. **`deriveTenantDekForVersion` + vitest BEFORE `/admin/crypto/
   rotate` UI ships.** Silent v1→v2 decrypt mismatch is
   unrecoverable on a real rewrap. Test the helper first.
4. **`submitWithApproval` migration BEFORE BulkBar primitive
   adopts the deployments wire.** AlertsTable.onBulkAck doesn't
   inspect status today (silent-success bug). Migrate 3 existing
   call-sites first, THEN ship the BulkBar primitive that
   consumes it.
5. **Sidebar inline-badge delete BEFORE NotificationBadge wire.**
   Otherwise sidebar renders the old shape and the Phase-11
   primitive gets adopted somewhere else, creating two badge
   shapes.
6. **`<StatusDot>` extraction + 2 inline-copy migrations BEFORE
   /network-devices ships.** 3rd copy would land otherwise.
7. **`<BulkBar>` extraction + 2 inline-copy migrations BEFORE
   deployments BulkBar wire.** 4th copy would land otherwise.
8. **cron-fire-eval extraction MUST preserve `withCronAuth` chain.**
   If the extracted helper bypasses auth, health-endpoint widening
   silently passes for un-authed crons.
9. **Saved-views zod envelope v: 1 FROM DAY ONE.** Without the
   version field, v2 migration in Phase 13 (or post-13 ideas) is a
   destructive read.
10. **`Fl_NetworkProbe` index `(networkDeviceId, ts DESC)` FROM
    DAY ONE.** Sequential scan on detail page would be the bug
    Phase 6 MSP triage hit.
11. **`Fl_CryptoRotation` table + lock semantics BEFORE rotate UI
    fires.** Concurrent rotation attempts must be blocked, not
    just discouraged.

---

## 4. Migrations + activation checklist

- [ ] DB backup (`pg_dump`) to `backup-dochub-pre-phase12-YYYYMMDD-
  HHMMSS.sql` immediately before DDL apply.
- [ ] Apply `migrations/phase-12.sql` (6 new tables + 2 new
  columns). Verify table count 39→45.
- [ ] Run `Fl_EvaluatorLease` smoke: insert a `monitor-evaluator`
  lease row manually, verify atomic CONFLICT path works.
- [ ] Verify `@date-fns/tz` installed; run 4-case DST vitest.
- [ ] Configure `CRITICAL_CRONS` env (or hardcode) — list of cron
  names that 503 the health endpoint when stale.
- [ ] Operator: add `/api/health` probe to crontab if not present.
- [ ] Operator: pcc2k-agent Go-side ships shell/file/backup verbs
  (out-of-repo work, tracked as Phase 12 exit-gate). xterm modal
  is FH-side-only until then; UI handles "agent has not advertised
  verb support" gracefully.

---

## 5. Phase 13 territory (architect-confirmed cuts)

Three items moved from Phase 12 to Phase 13:

1. **Mutable AV/EDR management.** Same agent-namespace blocker
   shape as `fleet.services.*` (Phase 13). Bundle both "needs new
   agent namespace" workstreams in Phase 13 — one agent-side
   release covers both `fleet.av.*` and `fleet.services.*`
   namespaces, one AGENT-PROTOCOL edit, one capability negotiation
   surface.
2. **Asset/warranty input UI + "Warranty expiring 90d" report.**
   UI-heavy polish, low coupling to anything else in Phase 12,
   naturally fits Phase 13's polish framing.
3. **WebAuthn cred rename/delete UI on /account/security.** Pure
   Phase-11 polish; not gating Phase 12 close.

Three items moved from Phase 13 to **explicit non-goals** so the
project actually closes at 13:

1. Risk-weight tuning UI on /msp
2. Per-tenant compliance weight override
3. 7-day sparkline per signal on triage table

These three are MSP-triage adornments on a feature that shipped
functional in Phase 6. They become Phase 14+ candidates if-and-
only-if a new design pass justifies a new project.

---

## 6. Out-of-scope deliberate non-goals

- Auto-discover network devices via SNMP walk (manual add only in
  v1; Phase 14+ idea if operator asks)
- Per-network-device alert thresholds (fixed defaults in v1;
  custom-monitor-expressions Phase 13 absorbs the general case)
- Maintenance-window dry-run / preview ("what would suppress"
  query) — operators read the audit log instead
- AV-mutable verbs (deferred to Phase 13 per §5)
- Asset/warranty UI (deferred to Phase 13 per §5)
- Cron-fire-eval generalization to non-cron schedules (Phase 14+)

---

## 7. Test gates

- `npm run typecheck` clean.
- `npx vitest run` — must include new test files plus the existing
  171 pass:
  - `tests/cron-fire-eval.test.ts` (cron-due logic, idempotent
    bumpLastFired, DST handling)
  - `tests/evaluator-lease.test.ts` (atomic CONFLICT, lease
    expiry, heartbeat)
  - `tests/oncall-dst.test.ts` (4 cases per §1.WS-E)
  - `tests/saved-views-envelope.test.ts` (zod safeParse, version
    drop)
  - `tests/submit-with-approval.test.ts` (discriminated union
    return shapes)
  - `tests/network-probe-rollup.test.ts` (hourly aggregation
    correctness)
- `npx playwright test` — smoke set for /network-devices, /admin/
  crypto/rotate, /devices/[id]?tab=remote xterm drawer.
- Manual: SNMP probe against a real switch/AP in the lab. ICMP
  probe against a known-up + a known-down host.
- Manual: Vault-KEK rotate dry-run (single tenant, 5 credentials).
  Verify all credentials still disclose post-rotation.
- Manual: Saved-views shape — save a view, reload, edit, delete.
- Manual: xterm drawer connect + commands + close-X disconnect
  flow.

---

## 8. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Vault rewrap mid-flight crash | high | `Fl_CryptoRotation` table records state; resumable. Per-row `SELECT FOR UPDATE` makes individual credential row atomic. Background job is idempotent on row level. |
| Network-probe row growth out of control | medium | 90d retention cron lands BEFORE probe cron (§3.2). Rollup table for >7d queries. |
| Cron-fire-eval extraction breaks `report-schedule.ts` | medium | Migrate report-schedule in the same PR as the extraction with the same vitest suite continuing to pass. |
| xterm bundle blows up `/devices/[id]` page weight | low | Dynamic import — xterm code only ships when ?tab=remote opens. |
| Saved-views envelope drift between v1 and Phase-13 schema | low | zod safeParse on read + drop-unknown-version-and-re-save. |
| Agent-side Go verbs not ready when Phase 12 ships | medium | UI handles "no verb support" gracefully. xterm modal shows "Agent does not advertise shell support" if last-heartbeat capability set lacks `shell.open`. |
| Cron-secret rotation undetected | low (now mitigated) | Health endpoint widening 503s when cron stale > 15min — drop-in for operator crontab probe. |

---

## 9. Sequencing summary

```
WS-E.1 Fl_EvaluatorLease table
WS-E.2 lib/cron-fire-eval.ts (with report-schedule.ts migration)
WS-E.3 lib/client/submit-with-approval.ts + migrate 3 call-sites
WS-E.4 @date-fns/tz + Fl_OncallSchedule.timezone + DST migration

WS-A.1 Fl_NetworkDevice + Fl_NetworkProbe + Fl_NetworkProbeHour schema
WS-A.2 lib/network-probe.ts (ICMP + SNMP via vault)
WS-A.3 /api/cron/network-probe-retain (LANDS BEFORE probe)
WS-A.4 /api/cron/network-probe + alert wiring
WS-A.5 /api/cron/network-probe-rollup
WS-A.6 <StatusDot> + 2 inline-copy migrations
WS-A.7 /network-devices list + new + [id] detail pages

WS-B.1 Fl_MaintenanceWindow schema
WS-B.2 /api/cron/maintenance-window-eval + Phase 3 plumbing reuse
WS-B.3 MaintenanceWindowForm (cloned from OncallScheduleForm)
WS-B.4 /admin/policies Maintenance subtab + TenantSettingsTab access

WS-C.1 deriveTenantDekForVersion + vitest
WS-C.2 Fl_CryptoRotation schema + rewrapTenantCredentials
WS-C.3 /admin/crypto + /admin/crypto/rotate wizard
WS-C.4 scripts/migrate-channel-secrets-to-vault.ts
WS-C.5 /api/cron/approval-expiry-sweep

WS-D.1 <StatusDot> shipped in WS-A.6
WS-D.2 <BulkBar> primitive + 2 inline-copy migrations
WS-D.3 <XtermDrawer> + /devices/[id]?tab=remote wire
WS-D.4 <SavedViewBar> + /api/account/saved-views + zod envelope
WS-D.5 Deployments BulkBar wire (consumes <BulkBar> + submitWithApproval)
WS-D.6 Alerts bulk-ack Undo toast (consumes <BulkBar variant="undo">)
WS-D.7 Sidebar inline-badge delete → NotificationBadge wire
       + /api/approvals?count=1 mode

WS-E.5 Fl_EvaluatorLease wired to all 6 cron consumers (LAST in WS-E)
WS-E.6 /api/health widening (cronLastSeenAt + 503 stale)
WS-E.7 6 new vitest files (cron-fire-eval, evaluator-lease,
       oncall-dst, saved-views-envelope, submit-with-approval,
       network-probe-rollup)
```

Total expected commits: **12–14** (architect target).

---

## 10. Open questions deferred to in-flight decisions

- **Network-device per-device alert thresholds.** v1 ships fixed
  thresholds. Whether to add per-device override columns OR defer
  entirely to Phase 13's custom-monitor-expressions — defer the
  decision; if custom expressions land cleanly in Phase 13, the
  network-device path composes there too.
- **xterm theme.** Default dark from xterm internals OR theme to
  FleetHub palette. Default is fine in v1 — operators expect
  terminal-dark.
- **Maintenance-window override slots.** Operator sometimes wants
  "skip this Sunday's window" without editing the cron. v1
  doesn't ship overrides; Phase 14+ idea if asked.
- **Background-job runner.** Vault rewrap is the first "this
  takes minutes" workload. v1 runs it in a route handler with
  `maxDuration = 300` and polls. If more workloads need this
  pattern, Phase 14+ might bring a real job queue (Inngest, BullMQ).
  Not in scope.

---

## 11. Why these workstreams, why this phase

The ROADMAP commits the project to closing at Phase 13. Phase 12
is the **second-to-last** phase — its job is consuming the
deferred backlog that's coherent under the "expand operational
surface" framing, while explicitly leaving Phase 13 to absorb the
agent-namespace bundle (`fleet.av.*` + `fleet.services.*`) +
final polish + project-close docs.

The architect's gut-check did three load-bearing things:
- **Split WS-B** (architect: maintenance-windows and AV-mutable
  are unrelated; the only shared property is "new noun" tier).
- **Pushed 3 items to Phase 13** (AV, asset/warranty, WebAuthn
  rename/delete) so Phase 12 ships in 12-14 commits, not 18-22.
- **Pushed 3 items to non-goals** (MSP polish trio) so Phase 13
  ships in 12-14 commits too — not a hidden second security
  bundle.

The 5 surviving workstreams are mutually independent and the
sequence allows ordered shipping with rollback at any commit.

---

**End of design.**
