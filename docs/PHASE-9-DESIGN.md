# FleetHub Phase 9 — Operator Loops + Hardening (Design)

**Status:** Draft, 2026-05-18. Not yet implemented. Phase 9 picks up
the post-Phase-8 punch list synthesized from four parallel agent
audits (feature-gap, UX, UI, code-review) plus the v1.5 deferrals
that earned production signal.

**Scope of this doc:** five workstreams. Like Phase 7/8, each is
independently shippable. Like every prior phase doc, the spec IS the
contract.

The five workstreams:

- **A — Action-from-here UX.** The audits converged on a single
  recurring complaint: FleetHub has the backend, the operator
  can't reach it from where they are. BulkBar buttons are
  placebos. The alert detail page makes you click 4-5 times to
  get to a fix. Deployment target pickers have no filters. Wire
  the loops Phase 8 left half-built.
- **B — Production hardening.** Silent-failure debt that survived
  Phase 8's vitest pass. 18 admin/mutation routes don't
  `writeAudit` — invisible hole in the HIPAA chain. 15 `JSON.parse
  as X` callsites bypass the zod schemas the write path enforces.
  Cooldown checks are non-transactional. Monitor evaluator does
  1000+ DB round-trips per minute at scale. Plus TOTP MFA on
  console login — a self-hosted RMM with password-only admin is a
  HIPAA / cyber-insurance fail.
- **C — Latent capabilities + mutable backup.** Ship the schemas
  that have no UI: `Fl_DeviceGroup` (defined in Phase 3, zero
  references in `app/`) becomes a real targeter for deployments
  + monitors + scripts. Asset/warranty lifecycle becomes a real
  report. Endpoint count auto-syncs to TicketHub MRR. Mutable
  backup trigger — Phase 8 §13 punted it; signal has arrived.
- **D — Agent surface extension.** Interactive shell + file
  transfer. These are the deepest "feels like an RMM" demo wins
  from the feature-gap audit. Bundled because they share the
  signed-body trust model, WSS transport, audit-chain, and
  per-tenant gating shape.
- **E — Phase 8 finish-line.** Visual debt that survived
  Phase 8 WS-C. `var(--color-warn)` is a phantom across 25
  callsites — a pure bug. Five duplicate `inputStyle` declarations
  bypass `FIELD`. Zero `loading.tsx` files across 47 pages.
  Detail-page severity palettes redeclare instead of importing
  `TONE`. This is a single small workstream — kept independent
  so a security review on WS-B can't hold the CSS pass hostage.

**Cross-references:**

- [`PHASE-7-DESIGN.md`](PHASE-7-DESIGN.md) — Workstream B's TOTP-MFA reuses NextAuth credentials flow; Workstream A's source-monitor-in-alert-detail builds on Phase 7's writeAlert kind convention
- [`PHASE-8-DESIGN.md`](PHASE-8-DESIGN.md) §13 — explicitly named mutable backup trigger as Phase 9 territory; this doc closes it. §11 sequencing pattern (primitives first, then features) reused as Phase 9's WS-C-first ordering.
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) — Workstream D adds new envelope methods (`shell.open`/`shell.input`/`shell.close`/`file.push`/`file.pull`); document the wire format the same way Phase 2/3 did
- [`HIPAA-READY.md`](HIPAA-READY.md) — Workstream B's writeAudit gap closure is the biggest HIPAA-chain improvement since Phase 5 step 13

---

## 1. What Phase 9 ships

Concretely, by the end of each workstream:

**Workstream A — Action-from-here UX:**

- `DeviceTable.BulkBar` wires "Run script" + "Reboot" + "Set
  maintenance" to real backends. Selecting 12 hosts on `/devices`
  and clicking Run script opens a single dialog with the existing
  Cmd-K script-picker; fan-out POSTs to `/api/devices/[id]/scripts`
  per id with one progress bar.
- `/alerts/[id]` ActionRow gains three buttons when the alert has
  a `deviceId`: **Remote in** (reuses `RemoteSessionLauncher`),
  **Run script…** (opens script-picker pre-bound to deviceId),
  **Related: N on this host** (link to
  `/alerts?deviceId=…&state=all`).
- `/deployments/new` target picker gains OS / online / role chip
  filters (mirroring `/devices`) + a "Select all matching filter"
  button + a "Use group: X" picker (after WS-C ships).
- `AlertRouteForm` + `RunbookForm` + `MonitorForm` Match section
  gains a live "Would have matched **N** alerts in last 7 days · 3
  samples" preview pane backed by a new
  `/api/admin/match-preview` endpoint.
- `AlertRouteForm` escalation rows gain `[Copy step 1]` + `[Use
  on-call email]` quick-fill buttons.
- `/alerts/[id]` Context card surfaces the source `Fl_Monitor` or
  `Fl_Runbook` when the alert kind matches `monitor.*` or
  `runbook.tripped`, with a link to `/monitors/[id]` /
  `/runbooks/[id]`.
- `/patches?tab=vulnerable` gains a `[Approve all KEV (N)]`
  button (typed-name confirm modal) that POSTs each KEV closing
  patch with `approvalState=needs-approval` and `isKev=true`.
- `/setup` landing deletes the two dead tiles ("Agent enrollment
  · Phase 1", "Integrations · Phase 1") and either deletes them
  or repoints to the surfaces that actually ship enrollment
  (`/clients/new`) and integrations (`/clients/[name]?tab=*`).

**Workstream B — Production hardening:**

- `writeAudit` on 18 currently-silent admin/mutation routes
  (`admin/alert-routes`, `admin/runbooks`, `admin/oncall-schedules`,
  `admin/tenants/[name]`, `report-schedules`, `rings/*`,
  `deployments/[id]/{abort,pause,resume,promote}`,
  `alerts/[id]/ack`, others). New `withAudit(handler, action)` HOC
  parallels `withCronAuth` shape.
- 15 read-side `JSON.parse(matchJson) as MatchPredicate` callsites
  swap to `lib/schemas/match.ts` `safeParse` helper. On parse
  failure: write a `kind:"route.skip.malformed"` audit row so
  silent drops become visible on `/audit`.
- `$transaction` wraps the cooldown check + fire-record in
  `runbook-evaluator.ts` and `monitor-evaluator.ts` (closes
  race-condition windows under prod cron load). Same wrap on
  admin DELETE paths.
- n+1 fix in `monitor-evaluator.ts:162-191` and
  `lib/perf/rollup.ts:81-189`: single `findMany({ deviceId: { in:
  ids }})` per cycle, group in-memory, single `groupBy` for
  cooldown lookup.
- `FLEETHUB_AGENT_SECRET` overload split: new `FLEETHUB_CRON_SECRET`
  for cron + pdf-thumbnail + ack-token surfaces. One-release
  fallback to `FLEETHUB_AGENT_SECRET` so existing deployments
  don't break on upgrade.
- Staff TOTP MFA: extend `Fl_StaffUser` with `totpSecret`,
  `mfaEnforcedAt`, `recoveryCodesJson`. NextAuth credentials
  provider gains a TOTP challenge step when `totpSecret` is set
  on the user record. Admin UI at `/setup/staff/[id]?tab=mfa`
  for enroll / regen-recovery-codes / disable.

**Workstream C — Latent capabilities + mutable backup:**

- `Fl_DeviceGroup` UI: new `/groups` list + `/groups/[id]`
  membership editor + `/groups/new` wizard. Wire as a `groupId`
  picker on `Fl_Deployment.targetGroupId`, `Fl_Monitor.scopeGroupId`
  (new field), and the script-run dialog. Existing schema
  already supports the targeter shape — pure UI + one wiring
  query in `lib/targeting.ts`.
- `Fl_Device` extension: `assetTag` (String?), `purchasedAt`
  (DateTime?), `purchasePriceCents` (Int?). New report kind
  `warranty-expiring` against existing `warrantyExpiresAt` + new
  fields, surfaces on `/reports` as "Warranties expiring in 90 days".
- PSA endpoint-count sync: new cron `/api/cron/psa-sync` reading
  `count(Fl_Device WHERE isActive)` per tenant, writing
  `TH_ContractItem.quantity` via cross-schema `$queryRaw`. Same
  pattern as `fa8e130` / Phase 8 contracts work. Operator-toggled
  per tenant via `Fl_Tenant.psaSyncEnabled` (default false).
- Mutable backup trigger: new agent verbs `backup.trigger` (asks
  the agent to start a backup) + `backup.cancel`. Reuses the
  Phase 8 posture detector binary (restic / wbadmin / Veeam CLI)
  for kick-off. New `Fl_BackupRun` model captures
  trigger/started/completed state. UI button "Trigger backup now"
  on `/devices/[id]` Posture card; ADMIN-only.

**Workstream D — Agent surface extension:**

- Interactive shell: new `Fl_ShellSession` model (id, deviceId,
  operatorEmail, justification, openedAt, closedAt, state, bytesTx,
  bytesRx). Agent verbs `shell.open` → returns sessionId +
  stdin/stdout stream channel handle on the WSS, `shell.input`
  (operator types), `shell.close`. Per-tenant
  `Fl_Tenant.shellSessionsEnabled` + `shellRequiresJustification`.
  UI: "Open shell" button on `/devices/[id]?tab=remote` opens a
  modal terminal (xterm.js or hand-rolled — see §10). Same
  ADMIN-gated + audit-row flow as `Fl_RemoteSession`.
- File transfer: new `Fl_FileTransfer` model (id, deviceId,
  direction "push"|"pull", remotePath, localPath, sha256,
  sizeBytes, state, requestedBy, completedAt). Agent verbs
  `file.push` (operator → agent) + `file.pull` (agent → operator).
  Push uploads to a signed-URL bucket (or `/tmp` on the host),
  agent fetches via authenticated GET; pull is the inverse.
  sha256-gated end-to-end. UI: per-device "Files" tab listing
  recent transfers + push/pull dialog.

**Workstream E — Phase 8 finish-line:**

- `var(--color-warn)` → `--color-warning` typo fix across 25
  callsites in 10 files. Single sed-and-commit PR. Affects every
  paused-deployment / pending-patch / maintenance-mode indicator
  in the app.
- FIELD primitive adoption on the 5 stragglers: `audit/page.tsx`,
  `setup/inbound-webhooks/InboundWebhooksClient.tsx`,
  `deployments/new/DeploymentForm.tsx`,
  `packages/new/NewPackageForm.tsx`, one more. Delete each local
  `inputStyle` const, import `FIELD` from `lib/ui-tokens`, spread
  into JSX.
- Shared `app/app/(protected)/loading.tsx` with a `<Card>`-shaped
  skeleton (3 rows shimmer). Per-segment overrides only where
  the layout differs materially. Closes the blank-screen-during-
  data-load problem on 47 force-dynamic pages.
- New `<InlineAlert tone="danger|warn|info">` primitive in
  `app/components/ui/InlineAlert.tsx`. Adopted at 4 hand-rolled
  sites (`AlertRouteForm`, `OncallScheduleForm`, `RunbookForm`,
  `RemoteSessionLauncher`).
- `TONE_PALETTE` export from `lib/ui-tokens.ts` covering
  bg + fg per severity. Replace the two inline palettes at
  `devices/[id]/page.tsx:1132` and `msp/page.tsx:288,609`.
- Inline body emoji sweep: replace the off-family glyphs in
  banners / chips (`🚨` paused-deployment, `🔒` maintenance,
  `🔔` AppShell badge) with either the same monochrome
  geometric set the sidebar uses or short text labels.

## 2. The pain points each workstream is built around

Sourced from the four parallel audits run before drafting. Same
format as Phase 8 §2.

| Workstream | Decision | Counters this audit finding |
|---|---|---|
| A | BulkBar buttons wired to real backends | Selecting 12 hosts on /devices and seeing four disabled buttons is the embarrassment Phase 8 promised to close but kicked. (UX #1, daily-pain) |
| A | Alert detail gains 3 in-line action buttons | Alert → fix is 4-5 clicks today. Every other RMM ships a one-click "Remote in from alert." (UX #2, daily-pain) |
| A | Match-preview pane on AlertRoute/Runbook/Monitor forms | Operator saves a routing rule with `kindLike=disk.*`, has zero feedback whether real alerts would match. Wrong glob = silent miss for weeks. (UX #4, weekly-pain) |
| A | Source-monitor/runbook link in alert detail | Operator can't ask "which monitor put this alert here" without grepping the kind string. (UX #6, weekly-pain) |
| B | writeAudit on the missing 18 routes | HIPAA chain has invisible gaps — admin route delete + runbook delete don't surface in /audit. (code #1, silent-failure-risk) |
| B | Read-side zod safeParse + audit silent drops | Write-side validates, read-side `JSON.parse as X` silently `continue`s on malformed. A manual SQL fix or future enum addition = invisible miss. (code #2, silent-failure-risk) |
| B | `$transaction` cooldown + admin DELETE | Two concurrent cron ticks can both pass the cooldown gate. Surfaces only under prod cron load. (code #3, silent-failure-risk) |
| B | n+1 fixes in evaluators | 1000+ DB round-trips/minute at 100 hosts × 5 monitors. Linear in fleet size. (code #4, growth-cost) |
| B | TOTP MFA | Self-hosted RMM admin login with password-only is a cyber-insurance / HIPAA fail. Insurance carriers ask for this on renewal. (feature gap #7, loses-demo) |
| B | FLEETHUB_AGENT_SECRET split | Rotating the agent secret invalidates cron + thumbnail + ack URLs in flight. One secret should not gate four unrelated surfaces. (code #6, growth-cost) |
| C | Fl_DeviceGroup UI | Schema shipped in Phase 3, zero `app/` references. Every deploy is one-by-one or whole-tenant. (feature gap #3, loses-demo) |
| C | Asset/warranty lifecycle report | `Fl_Device.warrantyExpiresAt` exists, no report kind. "Warranties expiring next quarter" is the second click for any MSP doing planning. (feature gap #9, nice-to-have) |
| C | PSA endpoint-count sync | TicketHub MRR shows on /msp but doesn't auto-bill per-endpoint. Datto/Atera sync into ConnectWise Manage. (feature gap #10, power-user) |
| C | Mutable backup trigger | Phase 8 §13 explicitly named this as Phase 9 territory; one tenant operator already asked. (Phase 8 §13 callout) |
| D | Interactive shell | "Open a PowerShell on this box right now" is checkbox 1 on every RMM eval call. (feature gap #1, loses-demo) |
| D | File transfer | "Push this driver / grab that log" is checkbox 2. (feature gap #2, loses-demo) |
| E | `--color-warn` typo fix | 25 callsites resolve to fallback hex (inconsistent yellow shades) or transparent text. Pure bug, visible daily. (UI #1, looks-bad) |
| E | FIELD primitive adoption + InlineAlert + TONE_PALETTE | Phase 8 WS-C unified the design system but five duplicate `inputStyle` and three inline severity palettes survived. (UI #2, #4, #5) |
| E | Shared loading.tsx | 47 force-dynamic pages, no skeleton. Operator sees blank-screen-with-sidebar during any slow query. (UI #3, looks-bad) |

## 3. Workstream A — Action-from-here UX

### 3.1 Schema

No new tables. One new field:

```prisma
model Fl_Monitor {
  // existing fields...
  scopeGroupId String?  // Fl_DeviceGroup.id (added in WS-C)
}
```

(Added to existing — see §9 for the full delta.)

### 3.2 BulkBar wiring

`app/components/DeviceTable.tsx` BulkBar at line 254/279. Current
state: four disabled buttons phase-tooltipped. New shape:

- **Run script…** — opens a `<ScriptPickerModal>` (new component
  in `app/components/ui/ScriptPickerModal.tsx`) with the same
  search shape as Cmd-K. On confirm: fan-out POST to
  `/api/devices/[id]/scripts` per selected id, render one progress
  bar. ADMIN-only.
- **Reboot** — `<ConfirmModal>` with the typed-name gate
  (`"reboot ${selectedCount} hosts"`). On confirm: fan-out POST to
  a new `/api/devices/[id]/reboot` route (or reuse the existing
  `reboot` script if it's curated). ADMIN-only.
- **Maintenance** — toggle: if any selected host is in maintenance,
  the button reads "Release maintenance"; otherwise "Set maintenance
  4h". Fan-out PATCH to `/api/devices/[id]` with `maintenance.on`.

Per-device errors collected; result modal shows "12 succeeded, 1
failed: dc01.acme — agent offline".

### 3.3 Alert detail ActionRow

`app/app/(protected)/alerts/[id]/page.tsx:141-209`. Three new
buttons added inside the existing `data-mobile-stack="actions"`
div, only when `alert.deviceId` is set:

- **Remote in** — reuses `<RemoteSessionLauncher>` (currently
  ActionBar-only on device detail). Pre-binds `deviceId`.
- **Run script…** — opens `<ScriptPickerModal>` (same component
  as 3.2) pre-bound to the single deviceId.
- **Related: N on this host** — `<Link href={"/alerts?deviceId=…
  &state=all"}>`. Server-side count of open + acked alerts on the
  same host.

### 3.4 Deployment target picker

`app/app/(protected)/deployments/new/DeploymentForm.tsx:209-247`.
Above the existing devices table, add:

- OS chip filter (Windows / Linux / macOS / Any)
- Online chip filter (Online / Offline / Any)
- Role chip filter (rendered from `Fl_Device.role` facets)
- Group picker (after WS-C ships) — "Use group: X" auto-selects
  the group's pinned + RQL-matched devices
- `[Select all matching filter]` button

Same FilterChip / FacetRow primitives used by `/devices` and
`/alerts`.

### 3.5 Match-preview pane

New route: `POST /api/admin/match-preview`. Body:
`{severity?: string, kindLike?: string, deviceTag?: string}`. Returns
`{count: number, samples: Array<{title, kind, severity, firedAt}>}`
sourced from `Fl_Alert` over the last 7 days.

Embed below the Match section of:
- `AlertRouteForm.tsx:230`
- `RunbookForm.tsx:77`
- `MonitorForm.tsx` (Match section)

Live-updates on field blur. Shows "Would have matched **17**
alerts in the last 7 days · sample: Disk full on dc01, ..." or
"0 alerts matched — double-check the kind glob".

### 3.6 Escalation copy-from-prior-step

`AlertRouteForm.tsx:266-330`. Each escalation row's header gains
two buttons:

- `[Copy step ${prev.label}]` — clones the prior step's channels
  array
- `[Use on-call email]` — pre-fills with the tenant's default
  on-call schedule's primary email

Pure client-side state manipulation. No backend change.

### 3.7 Source-monitor / source-runbook in alert Context

`alerts/[id]/page.tsx` Context card. When `alert.kind` starts with
`monitor.`, look up the `Fl_Monitor` row by `emitKind = alert.kind`
and surface "Triggered by monitor **${name}** (${severity} when
${predicateDescription} for ${forMin}m)" with a link to
`/monitors/[id]`. Same pattern for `runbook.tripped` →
`Fl_Runbook`.

One extra query per alert detail render (cached at request
boundary). No schema change.

### 3.8 Patches bulk-approve KEV

`patches/page.tsx:165-205`. Next to the "CVEs tracked" Tile, add
`[Approve all KEV (N)]` button. ADMIN-only. Typed-name confirm
("approve N KEV closing patches"). On confirm: POST to new
`/api/admin/patches/bulk-approve` with the list of patch IDs
matching `approvalState=needs-approval AND isKev=true`.

### 3.9 Setup dead-tile cleanup

`setup/page.tsx:40-53`. Delete the two phase-tooltipped tiles
("Agent enrollment · Phase 1", "Integrations · Phase 1"). Add one
"Quick links" tile linking to the actual surfaces:
`/clients/new` (for enrollment) + `/clients/[name]?tab=settings`
(for portal/branding/Scout integrations).

### 3.10 Sequencing inside WS-A

1. Match-preview API + form embedding (smallest, most validators-adjacent).
2. ActionRow expansion on alert detail.
3. Source-monitor/runbook link in alert Context.
4. /patches bulk-approve KEV.
5. /setup dead tiles.
6. BulkBar wiring — **wait until WS-C Fl_DeviceGroup lands** so the
   group-targeter on the deployment picker doesn't churn the same
   filter UI twice.
7. Deployment target picker filters + group picker.
8. Escalation copy-from-prior-step.

## 4. Workstream B — Production hardening

### 4.1 writeAudit gap closure

New HOC in `lib/with-audit.ts`:

```ts
export function withAudit<T>(
  action: string,
  handler: (req: NextRequest) => Promise<NextResponse>,
) {
  return async function(req: NextRequest) {
    const before = await captureBefore(req)
    const res = await handler(req)
    const outcome = res.ok ? "ok" : "fail"
    await writeAudit({ action, outcome, detail: { before, status: res.status }})
    return res
  }
}
```

Adopted at 18 sites identified by `grep -L writeAudit app/app/api/
**/route.ts | xargs grep -lE 'export async function (POST|PATCH|
DELETE|PUT)'`.

### 4.2 Read-side zod safety

New helper in `lib/schemas/match.ts`:

```ts
export function safeParseMatchPredicate(json: string): { ok: true; predicate: MatchPredicate } | { ok: false; reason: string } {
  // ...
}
```

15 callsites: `alert-dispatch.ts:122,160`, `runbook-evaluator.ts:49`,
`monitor-evaluator.ts:138`, etc. Replace
`try { JSON.parse(...) as MatchPredicate } catch { continue }` with
the safeParse helper. On `!ok`, write a `Fl_AuditLog` row
`{ action: "route.skip.malformed", detail: { routeId, reason }}` so
silent drops become surfaceable.

### 4.3 Transaction wrapping

`runbook-evaluator.ts:63-85` cooldown check + create → wrap in
`prisma.$transaction(async (tx) => { ... })` with
`SELECT pg_advisory_xact_lock(...)` per (runbookId, deviceId) pair.
Same pattern as `audit.ts` chain locking. Same wrap on the admin
DELETE paths in `admin/runbooks/[id]`, `admin/alert-routes/[id]`,
`admin/oncall-schedules/[id]`.

### 4.4 n+1 fixes

`monitor-evaluator.ts:162-191`: pull all `Fl_PerformanceSample`
rows for active device IDs in one `findMany({where: {deviceId:
{in: ids}, capturedAt: {gte: windowStart}}})`. Group in-memory by
deviceId + metric. Replace per-device cooldown `findFirst` with a
single upfront `groupBy({by: ['monitorId','deviceId'], where:
{firedAt: {gte: cooldownStart}}})`.

`lib/perf/rollup.ts:81-189`: same pattern — batch device IDs,
single query, group in memory.

Net diff: ~80 lines deleted (more loops collapse than batch code
adds). Tests added for both evaluators in WS-B step 7.

### 4.5 Cron secret split

Add `FLEETHUB_CRON_SECRET` to `.env.example`. `lib/with-cron-auth.ts`:

```ts
const secret = process.env.FLEETHUB_CRON_SECRET ?? process.env.FLEETHUB_AGENT_SECRET ?? ""
```

(One-release fallback to `FLEETHUB_AGENT_SECRET` so existing
deployments don't break on upgrade.) `lib/alert-ack-token.ts` and
`lib/pdf-thumbnail.ts` adopt the same fallback chain.

Document in the Phase 9 wrap-up: rotate `FLEETHUB_AGENT_SECRET`
no longer invalidates cron / thumbnail / ack URLs.

### 4.6 Staff TOTP MFA

Schema delta:

```prisma
model Fl_StaffUser {
  // existing fields...
  totpSecret          String?
  totpEnabledAt       DateTime?
  recoveryCodesJson   String?  // ["xxxx-xxxx", "yyyy-yyyy", ...] — bcrypt'd
  mfaEnforcedAt       DateTime? // if set, login MUST present TOTP
}
```

NextAuth credentials provider gains a TOTP challenge step: if
`totpSecret` set on the user, after password verification the
flow asks for the 6-digit code (or a recovery code). `otplib` is
the chosen dep (lightweight, well-maintained, no native bindings).

UI at `/setup/staff/[id]?tab=mfa`:
- Enroll: shows QR code + secret, requires confirming with the
  first 6-digit code before saving. Generates 10 recovery codes,
  shown once, downloadable as `.txt`.
- Regenerate recovery codes: ADMIN-only on other users; self for
  own account.
- Disable: requires re-entering the current TOTP code OR
  recovery code.

Enforcement: per-tenant `Fl_Tenant.mfaRequired` toggle. When set
to true and a user logs in without TOTP enrolled, redirect to
enrollment before reaching `/`.

### 4.7 Sequencing inside WS-B

1. writeAudit HOC + adoption (no risk; pure addition).
2. Read-side zod safety + silent-drop audit (additive).
3. Transaction wrapping (perf-neutral but safer).
4. n+1 evaluator fixes.
5. Cron secret split (additive with fallback).
6. TOTP MFA — last, since it changes the auth contract every
   other workstream depends on for `getSessionContext()`.
7. Tests: new vitest files for `runbook-predicate.ts` (untested
   today; silent-failure surface), `monitor-evaluator.ts`
   cooldown + sustain, `audit.ts` hash chain tamper detection.

## 5. Workstream C — Latent capabilities + mutable backup

### 5.1 Fl_DeviceGroup UI

Schema already exists from Phase 3 (`Fl_DeviceGroup` with `rql` +
`pinnedDeviceIdsJson`). What ships:

- `/groups` list (tenant filter, member count, RQL preview, last
  used)
- `/groups/[id]` membership editor (RQL or pinned list editor +
  preview pane "matches **N** current devices")
- `/groups/new` wizard
- Wire as `groupId` picker on:
  - `Fl_Deployment.targetGroupId` (existing field, no UI today)
  - `Fl_Monitor.scopeGroupId` (NEW field; see §9)
  - `Fl_Script` run dialog and BulkBar Run-script modal (WS-A 3.2)

Targeting resolver in `lib/targeting.ts`:

```ts
export async function resolveTargets(groupId: string): Promise<Fl_Device[]>
```

Single query: pinned device IDs + RQL-matched devices, deduped.

### 5.2 Asset/warranty cols + report

Schema delta to `Fl_Device`:

- `assetTag` (String?) — operator-entered asset tag
- `purchasedAt` (DateTime?) — purchase date
- `purchasePriceCents` (Int?) — for asset-value rollup

Editable on `/devices/[id]` summary tab in a new "Asset" subsection
(ADMIN-only). All three optional.

New report kind in `lib/reports.ts`:

```ts
export async function getWarrantyExpiring(daysAhead: number): Promise<WarrantyRow[]>
```

Surfaces on `/reports` as "Warranties expiring in 90 days" card,
sortable by tenant + expiry date. CSV export reuses the existing
report-export pattern.

### 5.3 PSA endpoint-count sync

New cron `/api/cron/psa-sync`. For each tenant where
`Fl_Tenant.psaSyncEnabled = true`, count `Fl_Device WHERE
isActive = true AND tenantName = X`, then cross-schema raw query:

```sql
UPDATE tickethub.th_contract_items
SET quantity = $count
WHERE "contractId" IN (SELECT id FROM tickethub.th_contracts WHERE "clientName" = $tenant)
  AND "syncSource" = 'fleethub-endpoint-count'
  AND "isActive" = true
```

`syncSource` is a new column on `TH_ContractItem` (cross-schema
migration). The cron writes only to rows operators tagged as
"sync from FleetHub" in the TicketHub UI — opt-in per contract
item.

Cadence: daily at 03:00 UTC. Idempotent — re-runs are no-ops if
counts haven't changed.

### 5.4 Mutable backup trigger

Phase 8 §13 punted this. Now in scope.

New model:

```prisma
model Fl_BackupRun {
  id            String   @id @default(cuid())
  deviceId      String
  device        Fl_Device @relation(fields: [deviceId], references: [id])
  product       String   // "veeam"|"datto"|"restic"|"windows-backup"
  triggeredBy   String   // operator email
  justification String?  // when tenant requires it
  state         String   // "queued"|"running"|"completed"|"failed"|"cancelled"
  startedAt     DateTime?
  completedAt   DateTime?
  errorMsg      String?
  createdAt     DateTime @default(now())
  @@index([deviceId, createdAt])
  @@map("fl_backup_runs")
  @@schema("fleethub")
}
```

New agent verbs (documented in AGENT-PROTOCOL.md):
- `backup.trigger { product }` → returns `{ runId }`
- `backup.cancel { runId }` → returns `{ ok }`

Agent-side: dispatch to the same per-product binary the Phase 8
posture detector uses (restic / wbadmin / Veeam CLI). Writes
`backup.run.started`, `backup.run.completed`, or
`backup.run.failed` envelopes back over WSS.

UI: "Trigger backup now" button on `/devices/[id]` Posture card.
ADMIN-only. Per-tenant `Fl_Tenant.backupTriggerEnabled` (default
false; operator opt-in per tenant). When set,
`Fl_Tenant.backupTriggerRequiresJustification` (default true) gates
the modal on a justification text field.

### 5.5 Sequencing inside WS-C

1. Fl_DeviceGroup UI (no schema change beyond `Fl_Monitor.scopeGroupId`).
2. Asset/warranty col additions + report (additive schema).
3. PSA sync cron (cross-schema concern; needs TH migration).
4. Mutable backup trigger (depends on agent-side build; can ship
   FH side first with a disabled UI).

## 6. Workstream D — Agent surface extension

### 6.1 Interactive shell

New model:

```prisma
model Fl_ShellSession {
  id              String   @id @default(cuid())
  deviceId        String
  device          Fl_Device @relation(fields: [deviceId], references: [id])
  operatorEmail   String
  justification   String?
  openedAt        DateTime @default(now())
  closedAt        DateTime?
  state           String   // "open"|"closed"|"timeout"|"agent-disconnected"
  bytesTx         Int      @default(0)
  bytesRx         Int      @default(0)
  exitReason      String?  // operator|timeout|disconnect|error
  @@index([deviceId, openedAt])
  @@map("fl_shell_sessions")
  @@schema("fleethub")
}
```

New `Fl_Tenant` fields:
- `shellSessionsEnabled` (Boolean, default false)
- `shellRequiresJustification` (Boolean, default true)
- `shellMaxDurationMin` (Int, default 60)

Agent protocol additions:

- `shell.open { deviceId, sessionId }` (operator → agent via
  signed dispatch). Agent spawns the appropriate shell
  (`powershell.exe` on Windows, `/bin/bash` on Linux/macOS) and
  hooks stdin/stdout/stderr to a new WSS stream channel.
- `shell.input { sessionId, data }` (operator → agent).
- `shell.output { sessionId, data }` (agent → server, broadcasted
  to the operator's open browser tab via SSE).
- `shell.close { sessionId, reason }` (either side).

UI: "Open shell" button on `/devices/[id]?tab=remote`. ADMIN-only.
Confirm modal (justification field if required + max-duration
hint). Opens a modal terminal window. Terminal renderer: **`xterm.js`**
(industry standard, ~150KB gzip, no native bindings, ANSI support).

Audit row written on open + close. Session bytes recorded for
the audit detail (no raw content stored — only stats).

Watcher cron (every 1m) closes sessions where
`openedAt + shellMaxDurationMin < now` and `state = "open"`, sends
`shell.close { reason: "timeout" }` to the agent.

### 6.2 File transfer

New model:

```prisma
model Fl_FileTransfer {
  id              String   @id @default(cuid())
  deviceId        String
  device          Fl_Device @relation(fields: [deviceId], references: [id])
  direction       String   // "push" | "pull"
  remotePath      String
  localPath       String?  // operator-side temp path; null on push pre-completion
  sha256          String?  // computed on completion
  sizeBytes       Int?
  state           String   // "queued"|"transferring"|"completed"|"failed"|"cancelled"
  requestedBy     String   // operator email
  justification   String?
  errorMsg        String?
  requestedAt     DateTime @default(now())
  completedAt     DateTime?
  @@index([deviceId, requestedAt])
  @@map("fl_file_transfers")
  @@schema("fleethub")
}
```

Per-tenant: `fileTransferEnabled`, `fileTransferRequiresJustification`,
`fileTransferMaxSizeMb`.

Agent verbs:
- `file.push { transferId, remotePath, signedUrl, expectedSha256 }`
  — agent fetches from FleetHub-hosted signed URL, writes to
  remotePath, hashes + reports back.
- `file.pull { transferId, remotePath }` — agent reads file,
  POSTs to a server endpoint with the bytes (chunked if needed),
  reports sha256.

Server storage: per-transfer temp file in `/tmp/fleethub-file-
transfers/<id>` with 5-minute TTL after `completed`. No long-term
storage — operator downloads + done.

UI: per-device "Files" tab listing recent transfers (state +
size + direction). Push dialog: file picker + remote path + justify.
Pull dialog: remote path + justify; on completion, browser
auto-downloads.

### 6.3 Sequencing inside WS-D

1. Fl_ShellSession schema + agent protocol doc + watcher cron.
2. Shell UI (xterm.js modal).
3. Fl_FileTransfer schema + agent protocol doc.
4. File transfer UI.

Shell and file transfer share the same per-tenant gating shape
+ ADMIN-only + audit-write + justification fields. Build shell
first; file transfer reuses the gating pattern.

## 7. Workstream E — Phase 8 finish-line

### 7.1 `--color-warn` → `--color-warning`

Single `git grep -l '--color-warn)' | xargs sed -i 's/--color-warn)/
--color-warning)/g; s/--color-warn,/--color-warning,/g'`. Verifies
on review that all 25 callsites now resolve to the actual variable.
~10 files affected.

### 7.2 FIELD primitive stragglers

Five files redeclare an `inputStyle` const, each subtly different:

- `audit/page.tsx:326`
- `setup/inbound-webhooks/InboundWebhooksClient.tsx:397`
- `deployments/new/DeploymentForm.tsx:279`
- `packages/new/NewPackageForm.tsx:147`
- One more (sweep via `grep -rn 'inputStyle.*background' app/`)

Each: delete the local const, import `FIELD` from `lib/ui-tokens`,
spread into existing `<input>`/`<select>` JSX.

### 7.3 Shared loading.tsx

New `app/app/(protected)/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SkeletonBar width="40%" height={24} />
        <SkeletonCard rows={3} />
        <SkeletonCard rows={5} />
      </div>
    </AppShell>
  )
}
```

`<SkeletonBar>` + `<SkeletonCard>` in `app/components/ui/Skeleton.tsx`.
CSS-animated shimmer (no JS). Per-segment overrides (`/msp`,
`/devices/[id]`) added only if a more specific layout helps.

### 7.4 `<InlineAlert>` primitive

New `app/components/ui/InlineAlert.tsx`:

```tsx
export function InlineAlert({ tone, children }: { tone: "danger"|"warn"|"info"; children: ReactNode }) { ... }
```

Adopted at the 4 hand-rolled sites:
- `AlertRouteForm.tsx:352`
- `OncallScheduleForm.tsx:223`
- `RunbookForm.tsx:214`
- `RemoteSessionLauncher.tsx:168`

### 7.5 TONE_PALETTE export

Add to `lib/ui-tokens.ts`:

```ts
export const TONE_PALETTE = {
  critical: { color: "var(--color-danger)", bg: "var(--color-danger-soft)" },
  warn:     { color: "var(--color-warning)", bg: "var(--color-warning-soft)" },
  info:     { color: "var(--color-info)", bg: "var(--color-info-soft)" },
  ok:       { color: "var(--color-success)", bg: "var(--color-success-soft)" },
  bad:      { color: "var(--color-danger)", bg: "var(--color-danger-soft)" },
  kev:      { color: "var(--color-kev)", bg: "var(--color-kev-soft)" },
  neutral:  { color: "var(--color-text-secondary)", bg: "var(--color-background-tertiary)" },
} as const
```

Replace inline severity palettes at `devices/[id]/page.tsx:1132`
and `msp/page.tsx:288,609`.

### 7.6 Inline emoji sweep

Body-emoji audit found `🚨` (deployments paused banner, patches
chip), `🔒` (maintenance — 4 sizes/contexts), `🔔` (AppShell badge)
mixing with the operator-chosen monochrome sidebar set. Either
swap to short text labels ("AUTO-PAUSED", "MAINT", "BELL") or
match the sidebar's monochrome-geometric family (`⚠`, `🔔`
kept as accepted-sidebar-canon). Decision per-site at PR time;
default: short text labels in banners, accepted-sidebar-canon in
chip badges.

### 7.7 Sequencing inside WS-E

Each item is a tiny PR (5-20 lines). No internal ordering — ship
in any sequence as calendar permits. WS-E is the "between phases"
work that closes Phase 8 polish without holding up Phases 9 A/B/C/D.

## 8. Shared infrastructure

- The `<ScriptPickerModal>` primitive used by WS-A BulkBar (3.2)
  + alert detail Run-script button (3.3) is built once, reused
  by both.
- The signed-body trust model used by `Fl_ShellSession` (D 6.1) +
  `Fl_FileTransfer` (D 6.2) reuses the `Fl_ScriptRun` Phase 2
  pattern (HMAC over body bytes; agent verifies before executing).
- `Fl_DeviceGroup` from WS-C is consumed by WS-A's deployment
  target picker (3.4). WS-A waits for WS-C.
- `writeAudit` from WS-B is consumed by every new mutation route
  in WS-C + WS-D. WS-B's audit HOC lands before WS-C/D's new
  routes.
- `TONE_PALETTE` from WS-E is consumed by WS-A's source-monitor
  Context card (3.7) — small, can land in either WS-A or WS-E
  first.

## 9. Schema additions (full delta vs Phase 8)

New models:
- `Fl_BackupRun` (WS-C 5.4)
- `Fl_ShellSession` (WS-D 6.1)
- `Fl_FileTransfer` (WS-D 6.2)

`Fl_Device` additions:
- `assetTag` (String?)
- `purchasedAt` (DateTime?)
- `purchasePriceCents` (Int?)

`Fl_Monitor` additions:
- `scopeGroupId` (String?) — references `Fl_DeviceGroup.id`

`Fl_StaffUser` additions:
- `totpSecret` (String?)
- `totpEnabledAt` (DateTime?)
- `recoveryCodesJson` (String?)
- `mfaEnforcedAt` (DateTime?)

`Fl_Tenant` additions:
- `mfaRequired` (Boolean, default false)
- `psaSyncEnabled` (Boolean, default false)
- `backupTriggerEnabled` (Boolean, default false)
- `backupTriggerRequiresJustification` (Boolean, default true)
- `shellSessionsEnabled` (Boolean, default false)
- `shellRequiresJustification` (Boolean, default true)
- `shellMaxDurationMin` (Int, default 60)
- `fileTransferEnabled` (Boolean, default false)
- `fileTransferRequiresJustification` (Boolean, default true)
- `fileTransferMaxSizeMb` (Int, default 100)

Cross-schema (TicketHub side):
- `TH_ContractItem.syncSource` (String?, nullable) for PSA sync
  opt-in marker. Migration runs on the TH side.

No changes to existing Phase 8 tables.

## 10. Optional integrations + per-deploy decisions

- **xterm.js for shell terminal** — chosen over hand-rolling for
  ANSI escape sequence handling, paste support, copy-on-select.
  ~150KB gzip. If the operator prefers a different terminal lib
  (e.g. CodeMirror's terminal mode), swap is mechanical (one
  component file).
- **otplib for TOTP** — chosen for: pure-JS (no native bindings),
  RFC 6238 + RFC 4226 compliance, recovery-code generation built
  in. ~30KB. WebAuthn deferred to Phase 10 (heavier infra: per-
  device key storage, browser-only).
- **PSA-sync vendor variance** — v1 syncs to TicketHub
  (cross-schema raw query). External PSAs (ConnectWise Manage,
  HaloPSA, Autotask) need vendor-specific API adapters; deferred
  unless an operator brings one of those PSAs.
- **Shell + file transfer max-duration / max-size** — fixed in
  v1 per-tenant via `Fl_Tenant` fields. Per-session overrides
  (operator types "give me 4 hours" in justification) deferred
  to v1.5.
- **Backup trigger product detection** — agent reuses Phase 8
  posture detector binary path. If a tenant has both Veeam +
  restic installed, agent picks the one with `posture.product`
  matching; UI shows a dropdown "Trigger backup with: Veeam /
  restic" when both are present.

## 11. Sequencing across workstreams

The five workstreams have one hard ordering constraint and two
soft ones:

1. **WS-E first** (or in parallel with WS-A start). All small,
   safe-to-defer-per-item, but `TONE_PALETTE` from §7.5 is
   consumed by WS-A 3.7. Ship E items as calendar permits.
2. **WS-B writeAudit HOC** before WS-C + WS-D new routes — every
   new route in WS-C (groups, backup-trigger, PSA-sync cron) +
   WS-D (shell open/close, file-transfer endpoints) should land
   with audit-write from day one.
3. **WS-C Fl_DeviceGroup** before WS-A BulkBar wiring + deployment
   target picker — both consume the group targeter primitive.
   WS-A's 3.2 + 3.4 wait for WS-C 5.1.
4. **WS-B TOTP-MFA last within WS-B** — every other WS-B item
   should land first; MFA changes the auth contract every
   workstream depends on.
5. **WS-D shell before file transfer** — same per-tenant gating
   shape; build shell, then file transfer reuses the pattern.

Recommended order:

1. WS-E (paint the small bug fixes; closes Phase 8 finish-line).
2. WS-B steps 1-5 (audit HOC, zod safety, transactions, n+1, secret split).
3. WS-A 3.1-3.4 (match preview, ActionRow, source-link, /patches KEV).
4. WS-C 5.1-5.2 (groups + asset/warranty).
5. WS-A 3.2 + 3.4 finish (BulkBar + deployment filter — now that
   groups exist).
6. WS-C 5.3-5.4 (PSA sync + mutable backup).
7. WS-D 6.1-6.2 (shell + file transfer).
8. WS-B step 6 (TOTP MFA — last, since auth contract change).
9. WS-B step 7 (tests for runbook-predicate + audit chain).

Each workstream can ship standalone; the dependencies above are
the only hard ordering constraints.

## 12. Open questions

- **PSA sync API surface.** v1 ships internal TicketHub sync only.
  ConnectWise Manage + HaloPSA + Autotask are real prospects'
  PSAs. Per-vendor adapter pattern (mirroring Phase 8 inbound-
  mappers) is the natural shape; defer until an operator brings
  one of those PSAs.
- **Shell session recording.** Should the shell session record
  full stdin/stdout to disk (encrypted) for after-the-fact audit?
  v1 records bytes-tx/rx counts only. Content recording deferred —
  raises HIPAA + storage concerns disproportionate to v1 need.
- **Backup trigger granularity.** v1 triggers a full backup; "trigger
  incremental only" / "trigger differential" deferred. Operator
  override via justification text for v1; structured trigger
  options for v1.5 if asked.
- **MFA enforcement default.** v1 ships `Fl_Tenant.mfaRequired =
  false` per tenant; operator opts in. Should the default flip
  to true post-Phase-9-soak? Probably; defer the policy decision
  to Phase 10 wrap-up.
- **WebAuthn / passkey support.** TOTP is v1; WebAuthn is a
  Phase 10 concern (browser-coupled, more infra). Recovery codes
  fill the same "lost-device" gap for v1.

## 13. Non-goals (out of scope for Phase 9)

- **Network device monitoring (SNMP / ICMP).** Major architecture
  extension — moves FleetHub from agent-only to agent-or-probe.
  Worth its own design pass + own phase. Phase 10 candidate.
- **Credential vault per client.** Heavy security infra (per-tenant
  encryption keys, unlock sessions, key rotation). Phase 10
  candidate; overlaps with existing portal vault pattern.
- **Recurring tenant maintenance windows.** Cron-schedule UX needs
  its own design pass — overlaps with monitor + runbook cadence
  + scheduled reports. Phase 10 candidate.
- **AI alert correlation / root-cause clustering.** Phase 8 §13
  punt; still out.
- **White-label / multi-MSP federation.** Phase 7/8 §13 punts; still
  out.
- **WebAuthn / passkey login.** Phase 10. v1 ships TOTP only.
- **Shell session content recording.** Privacy + storage concerns
  out of proportion to v1 need. v1 records byte counts; full
  content recording deferred.
- **Mutable AV / EDR management (force-scan / disable / quarantine).**
  Phase 8 §13 explicitly out; still out. Only `backup.trigger` +
  `backup.cancel` move from read-only to mutable in Phase 9.
- **Alert evaluator queue throttling.** v1.5 deferral; load-signal-
  gated. Phase 9 ships n+1 fixes which address the same perf
  surface from a different angle; queue throttling waits for
  measured spike load.

## 14. Voice check

Voice: this is the phase where FleetHub stops feeling like "an
RMM that's missing the basics" and starts feeling like "an RMM
you'd use on the job." Every WS-A decision answers "can the
operator act from where they're already looking?" Every WS-B
decision answers "would a HIPAA auditor sleep well?" Every WS-C
decision answers "did we ship the schemas we drew up?" Every
WS-D decision answers "does this feel like a real RMM in a
demo?" Every WS-E decision answers "is the visual debt that
survived Phase 8 still pulling its weight as debt?"

No new admin mutation route without `withAudit`. No new
`JSON.parse(...) as X` callsite — read-side safeParse only. No
new cron without `withCronAuth` + `FLEETHUB_CRON_SECRET`. No new
hand-rolled `inputStyle` — `FIELD` only. No new agent verb that
isn't documented in `AGENT-PROTOCOL.md` before code lands. No
new feature that bypasses ADMIN-gate + audit-write. The phase is
about loop-closing as much as features.
