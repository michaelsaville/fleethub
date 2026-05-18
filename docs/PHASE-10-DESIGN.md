# FleetHub Phase 10 — Loop-Closure + Operator Power Tools (Design)

**Status:** Draft, 2026-05-18. Not yet implemented. Phase 10 is the
**deliberately small follow-up phase** to Phase 9. The audits that
preceded this doc surfaced 30+ candidate items; the architect pushed
back hard on bundling them. Phase 10 ships **five tight workstreams**:
finish what Phase 9 started, harden what Phase 9 didn't get to, and
land the operator-productivity surfaces the audits flagged.

**Scope of this doc:** five workstreams. Like prior phases, each is
independently shippable. Like prior phase docs, the spec IS the
contract.

The five workstreams:

- **A — Phase 9 loop-closure.** pcc2k-agent handlers for the verbs
  Phase 9's FH side dispatches (shell.open/close, file.push/pull,
  backup.trigger/cancel) + the three corresponding ingest envelope
  handlers (shell.exited, file.transfer.complete, backup.complete)
  that today return 400. xterm.js modal terminal UI. Tenant-settings
  UI for the 10 Phase-9 per-tenant toggles. Wire Fl_DeviceGroup as a
  real targeter for deployment/scripts/patches dispatch paths
  (Phase 9 shipped the schema + UI but inspect-only).
- **B — Hardening continuation.** Audit-chain dedup (two near-identical
  SHA-256 canonical functions). agent-ingest reject-path audits
  (HMAC-rejected + JSON-parse-failed paths currently return 400 with
  no audit row — invisible attack surface). Read-side zod safeParse
  for the 6 remaining JSON columns Phase 9's §4.2 sweep didn't
  reach. alert-escalator n+1 fix (Phase 9 fixed monitor-evaluator
  but missed this neighbor). Five new vitest files including
  audit-chain tamper detection and mfa.ts coverage.
- **C — Operator power tools.** Saved views (Fl_StaffUser.savedViewsJson
  defined since Phase 0, zero UI). Bulk-ack Undo toast on /alerts.
  Deployments list filters + bulk-pause/resume/abort. Audit log
  quick-range presets. On-call schedule TZ-aware preview. New
  Fl_DeviceNote + Fl_TenantNote tables (no KB exists today). Asset/
  warranty input UI on /devices/[id] + "Warranty expiring 90d"
  report kind.
- **D — Visual debt finish-line II.** patches `pill()` survivors
  migrate to Chip + TONE_PALETTE. Four hand-rolled Tile widgets
  fold into a `StatCard size="sm"` variant. TYPOGRAPHY.H1 enforcement
  on the three pages that drift to 18/22. Six hand-rolled `btnPrimary`
  helpers fold into Button. Sidebar emoji actually unified (12
  colored + 5 monochrome mixed today). TONE_PALETTE adoption on the
  detail-page severity palettes. TH/TD primitive adoption sweep
  (zero importers today).
- **E — MFA login gate.** Standalone, sequenced last. Post-Azure-AD
  challenge page that gates session creation when totpEnabledAt is
  set on the user record OR when Fl_Tenant.mfaRequired is on. v1
  ships TOTP only (already enrolled in Phase 9); recovery-code path
  + ENROLL-NOW redirect for tenants flipping mfaRequired on.

**Cross-references:**

- [`PHASE-9-DESIGN.md`](PHASE-9-DESIGN.md) §13 — Phase 10 was named
  as the home for network device monitoring, credential vault,
  recurring tenant maintenance windows, WebAuthn, and 4-eyes approval
  workflows. The architect's gut-check pulled **all of those** to
  Phase 11 — see §13 below for the rationale.
- [`PHASE-9-DESIGN.md`](PHASE-9-DESIGN.md) §11 — Phase 9 sequenced
  TOTP MFA last. Phase 10 sequences the MFA *gate* last for the same
  reason (auth-contract change).
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) — Workstream A adds three
  new ingest envelope kinds (shell.exited, file.transfer.complete,
  backup.complete). Document the wire format before code lands per
  the Phase 8/9 voice rule.
- [`HIPAA-READY.md`](HIPAA-READY.md) — Workstream B's audit-chain
  dedup + agent-ingest reject-path audits close the biggest HIPAA
  chain gaps surviving Phase 9.

---

## 1. What Phase 10 ships

Concretely, by the end of each workstream:

**Workstream A — Phase 9 loop-closure:**

- pcc2k-agent commit adding handlers for:
  - `shell.open` → spawn powershell.exe / bash, hook stdio to WSS
    stream channel, register sessionId for `shell.input` routing
  - `shell.close` → terminate session, emit `shell.exited` callback
  - `shell.input` → write to running session's stdin
  - `file.push` → fetch from signedUrl, write to remotePath, hash,
    emit `file.transfer.complete`
  - `file.pull` → read from remotePath, chunked upload to FH,
    emit `file.transfer.complete`
  - `backup.trigger` → dispatch to per-product binary (restic /
    wbadmin / Veeam CLI from Phase 8 posture detector), emit
    `backup.complete`
  - `backup.cancel` → kill running run, emit `backup.complete` with
    state="cancelled"
- Three new envelope handlers in `lib/agent-ingest.ts`:
  - `shell.exited { sessionId, exitReason, bytesTx, bytesRx }`
    updates Fl_ShellSession state="closed", closedAt, exitReason
  - `file.transfer.complete { transferId, state, sha256?, sizeBytes?,
    errorMsg? }` updates Fl_FileTransfer
  - `backup.complete { runId, state, errorMsg? }` updates Fl_BackupRun
- xterm.js modal terminal UI on `/devices/[id]?tab=remote` "Open
  shell" button. Streams via SSE from FleetHub's session-output
  cache (server-side keeps a sliding 1MB ring buffer per session;
  refresh = replay the buffer; not a content-recording surface).
- Tenant-settings UI for the 10 toggles Phase 9 added but left
  Prisma-only. Lives at `/clients/[name]?tab=advanced` as a new
  tab. Each toggle has an explanatory blurb and links to the
  feature's docs section.
- Fl_DeviceGroup wired as a `groupId` parameter on:
  - `POST /api/deployments` body: accept `{ targetGroupId? }`;
    when present, server calls `resolveGroupTargets(groupId)`
    and substitutes for targetDeviceIds.
  - `POST /api/scripts/[id]/run` body: accept `{ groupId? }`;
    server resolves and fans out fan-out POSTs to each device.
  - `POST /api/patches/[id]/deploy` body: accept `{ groupId? }`;
    server resolves.
  - UI in DeploymentForm.tsx + script-run dialog: "Use group: X"
    dropdown above the device table; on select, pre-checks +
    freezes the resolved set with an "or override" toggle to
    return to manual selection.

**Workstream B — Hardening continuation:**

- Move canonical `hashRow` to `lib/audit-chain.ts`; `lib/audit.ts`
  imports + re-exports. Single source of truth for the audit
  hash inputs. Comment block stays: "Hash inputs MUST match
  Fl_AuditLog's writer" but now enforced by import, not convention.
- Three new `writeAudit` calls in `app/api/agent-ingest/route.ts`
  on HMAC-rejected, JSON-parse-failed, and missing-required-headers
  paths. Action label `agent.ingest.rejected`, outcome `error`,
  detail `{ reason }`. Brute-force probes now leave a trail.
- Read-side `safeParse*Json` helpers for the 6 remaining JSON
  columns Phase 9 §4.2 didn't reach:
  - `predicateJson` (Fl_Monitor) — bounded shape per metric
  - `channelsJson` (Fl_AlertRoute) — discriminated union per channel
    type (slack/teams/email/sms/pagerduty/ticket)
  - `escalationJson` (Fl_AlertRoute) — array of channels per step
  - `deliveryJson` (Fl_ReportSchedule) — same channel union
  - `pinnedDeviceIdsJson` (Fl_DeviceGroup) — array of cuid strings
  - `inventoryJson` (Fl_Device) — the largest blob; bounded schema
    for hardware/software/services keys consumed by UI today
- alert-escalator n+1 fix. Currently: per-due-group `findUnique`
  on Fl_AlertRoute + `count` on Fl_AlertDispatch. With BATCH=200
  groups, that's 400+ queries per tick. Same pattern as Phase 9's
  monitor-evaluator fix: batch-load distinct routeIds into a Map,
  single groupBy for dispatch counts.
- Five new vitest files:
  - `audit-chain.test.ts` — insert → tamper → verify (the highest-
    stakes uncovered surface).
  - `mfa.test.ts` — deterministic TOTP vectors (RFC 6238 test data),
    recovery-code consume-once semantics.
  - `monitor-evaluator.test.ts` — cooldown + sustain + batched
    sample lookup correctness (Phase 9's fix landed without test
    coverage).
  - `runbook-predicate.test.ts` — exitCode / stdoutContains /
    stdoutRegex evaluator (silent-failure surface).
  - `alert-channels/index.test.ts` — preflight + send per adapter,
    happy + missing-config paths.

**Workstream C — Operator power tools:**

- Saved views on `/alerts` + `/devices`. New "Save view" button
  next to the filter strip; persists current querystring + label
  to `Fl_StaffUser.savedViewsJson` (column exists since Phase 0,
  zero consumers). Chips above the filter strip list saved views;
  click loads. Cmd-K surfaces them under a "Saved views" category.
- Alerts bulk-ack Undo toast. Server action returns the list of
  acked alert ids; client shows a 6-second toast "Acked N alerts ·
  Undo" with action POSTing to a new `bulkUnackAlerts(ids)`
  endpoint (audited). New `<Toast>` primitive in `components/ui/`
  with a tone+action+timeout shape.
- Deployments list filters + BulkBar. Status + Tenant chip filters
  above the table (same FilterChip primitives as the Phase 9
  deployment target picker). Row-checkbox column. Sticky BulkBar
  with Pause / Resume / Abort buttons; mirrors `/devices` BulkBar
  shape exactly. Existing `/api/deployments/[id]/{pause,resume,
  abort}` routes are already audited via Phase 9 WS-B; BulkBar
  fans out per-id calls with a single progress bar.
- Audit log quick-range presets. Chip row above the existing
  filter form: Last 1h / 24h / 7d / 30d. Click writes `from` +
  `to` to the form + auto-submits. Preserves the existing actor /
  action / outcome inputs.
- On-call schedule TZ-aware preview. Each rotation slot's UTC
  HH:MM rendering gets a `= local-TZ-from-tenant` suffix on the
  same line. Same for the override datetime-locals. Tenant TZ
  defaults to America/New_York when unset; new `Fl_Tenant.timezone`
  column (IANA name, optional) when an operator wants per-tenant
  override.
- New `Fl_DeviceNote` + `Fl_TenantNote` tables. Markdown body,
  audit-row on every CRUD, soft-delete column. Surface on
  `/devices/[id]` summary tab (collapsed by default; expand to
  edit) and `/clients/[name]?tab=notes`. Pinned-to-top option for
  the "the admin pw is in vault, switch is in MDF" pattern.
- Asset/warranty input UI on `/devices/[id]` summary tab. Three
  fields editable when role >= TECH: assetTag (free-form),
  purchasedAt (date), purchasePriceCents (cents → display as
  $XX.XX). Lives in a new "Asset" subsection on the summary tab
  alongside the existing Posture card.
- "Warranty expiring 90d" report kind. New `getWarrantyExpiring(
  daysAhead)` in lib/reports.ts. Surfaces on `/reports` as
  "Warranties expiring in 90 days" card. CSV export via the
  existing report-export pattern.

**Workstream D — Visual debt finish-line II:**

- patches/page.tsx + patches/[id]/page.tsx `pill()` survivors
  (rectangular, hex-literal) → Chip + TONE_PALETTE (rounded,
  token-driven). Adds `source` + `cvss-band` entries to
  TONE_PALETTE or a `solidHex` mapping so the 4 source brand
  colors live in one place.
- StatCard size variant. Add `size?: "lg" | "sm"` prop; lg is
  current (28px value), sm is the four hand-rolled call sites
  (clients/[name], patches, reports, software → 18px). Forces
  hyperlinkability for free; closes UI-PATTERNS.md "hyperlink
  every dashboard number."
- TYPOGRAPHY.H1 enforcement. Replace inline `fontSize: "22px"` in
  devices/[id]:216 + clients/[name]:117 with `style={TYPOGRAPHY.H1}`.
  Drop the 18px in audit/page.tsx:38 too. Three call sites.
- Button adoption sweep. Six `btnPrimary()` helpers (packages/[id],
  packages/new, audit/page, deployments/new, deployments/[id]/
  DeploymentControls, patches/[id]) → `<Button variant="primary">`.
  Delete the local helpers.
- Sidebar unification. Audit found the Phase 8 "unification" left
  12 colored emoji + 5 monochrome glyphs side-by-side. Pick one
  family — operator already chose emoji-monochrome in Phase 8 §14
  voice, so the colored ones are the wrong direction. Two paths
  (operator picks at PR time): swap colored → monochrome unicode
  glyphs (◫ ⌂ ▣ ⌇ ▤ ✱ …), OR find more consistent emoji that
  render as flat-monochrome on macOS/iOS. Also: drop the stale
  "Phase 0 · scaffold" footer subtitle.
- TONE_PALETTE adoption on detail pages. devices/[id]:1131 rgba
  literals → `TONE_PALETTE[tone]`. alerts/[id]:69 sevColor ternary
  → same lookup. Eliminates the parallel severity ladders.
- TH/TD primitive adoption. Zero importers today; every `<table>`
  ships its own th()/td() inline. Mechanical sweep: import +
  spread, delete locals.

**Workstream E — MFA login gate (standalone, last):**

- New `/mfa-challenge` page. After Azure AD callback returns,
  middleware checks: if the user has `totpEnabledAt` set OR the
  tenant has `mfaRequired = true`, the session lands at the
  challenge page before any protected route.
- Challenge form: 6-digit TOTP input, or "Use a recovery code"
  link toggle. Submits to `/api/auth/mfa-verify` which marks the
  session as `mfaCleared`.
- Session middleware tightening: protected routes check
  `session.mfaCleared` when the user's `totpEnabledAt` is set.
  Without it, redirect to /mfa-challenge.
- Tenant-required enrollment flow: when `Fl_Tenant.mfaRequired`
  flips true and a user has no `totpEnabledAt`, sign-in lands at
  `/setup/staff/[id]?tab=mfa` with an explanatory banner and the
  Enroll button pre-opened. They cannot reach a protected route
  until enrollment completes.
- Audit rows for every challenge outcome: `mfa.challenge.ok`,
  `mfa.challenge.fail`, `mfa.challenge.recovery-used`,
  `mfa.enrollment.forced`.

## 2. The pain points each workstream is built around

Sourced from four parallel audits run before drafting. Same format
as Phase 8 + 9 §2.

| Workstream | Decision | Counters this audit finding |
|---|---|---|
| A | pcc2k-agent verbs + 3 ingest handlers | Phase 9 dispatches `backup.trigger`, `shell.open`, etc. but the agent has no handlers and the return-frame ingest envelopes have no parser. Sessions hang in `state="open"` until the watcher cron times out. Silent half-laid pipe. (code #7) |
| A | xterm.js modal | Phase 9 shipped the schema + routes but no operator-facing terminal. Open shell → operator sees a session row but nothing they can type into. (Phase 9 deferred follow-up) |
| A | Tenant-settings UI for 10 toggles | Phase 9 added mfaRequired, psaSyncEnabled, backupTriggerEnabled, shellSessionsEnabled, fileTransferEnabled, etc. as Prisma-only columns. Operator-as-Prisma is exactly the pattern Phase 8 WS-D 6.1 closed for phoneE164 — same gap. (Phase 9 deferred follow-up) |
| A | Wire Fl_DeviceGroup as targeter | Phase 9 shipped /groups + lib/targeting.ts but only the inspect-only UI. Deploy + script-run + patch-deploy still take flat deviceIds[]; operator hand-selects every campaign. (UX #1, daily-pain; code #6) |
| B | Dedupe audit-chain hashRow | lib/audit.ts + lib/audit-chain.ts maintain byte-identical canonical hash functions enforced by convention. Any future column add silently breaks the verifier. (code #1, silent-failure-risk) |
| B | agent-ingest reject-path audits | HMAC-rejected / JSON-parse-failed paths return 400 with zero audit row. Brute-force / replay attempts are invisible. (code #2, silent-failure-risk) |
| B | Read-side zod sweep — 6 cols | Phase 9 §4.2 fixed matchJson; 6 cousin columns still raw-parse. Each silently degrades to "errored" / "no channels" without typed contract. (code #3, silent-failure-risk) |
| B | alert-escalator n+1 fix | Phase 9 fixed monitor-evaluator; alert-escalator has the same per-due-group `findUnique` pattern. Linear with fleet size. (code #4, growth-cost) |
| B | 5 new vitest files | mfa.ts + audit-chain.ts are highest-stakes uncovered surfaces post-Phase-9. monitor-evaluator's fix landed without test coverage. (code #5, silent-failure-risk on mfa+audit-chain) |
| C | Saved views | `Fl_StaffUser.savedViewsJson` has shipped since Phase 0 with zero consumers; operators rebuild the same querystring hundreds of times. (UX #6, weekly-pain) |
| C | Alerts bulk-ack Undo + Toast | A mis-click bulk-acks 30 alerts with no recovery and no feedback today. Phase 8 added the BulkBar pattern; toast + undo close the loop. (UX #2, daily-pain) |
| C | Deployments list filters + BulkBar | `/deployments` is a 100-row dump with no facets and no bulk ops. Pausing every running deploy during an outage = open each row individually. (UX #3, daily-pain) |
| C | Audit log quick-range presets | "What did this user do in the last 24h" = 4-click ritual today. (UX #5, weekly-pain) |
| C | On-call TZ preview | Schedule editor speaks only UTC; every weekly rotation needs mental conversion. (UX #4, daily-pain) |
| C | Device/tenant notes (KB-lite) | No KB anywhere. Every RMM has at least a per-device note panel ("admin pw is in vault"). The full credential vault is Phase 11 — this is the gateway capability. (feature gap #6) |
| C | Asset/warranty input UI | Phase 9 schema landed (assetTag, purchasedAt, purchasePriceCents); operator-facing input is the missing surface for the existing data shape. (Phase 9 deferred follow-up) |
| C | "Warranty expiring 90d" report | Phase 9 schema landed; renderer is the missing surface. (Phase 9 deferred follow-up) |
| D | patches pill() → Chip | The single highest-traffic surface with rectangular pills against rounded chips everywhere else. Visible daily. (UI #1, looks-bad) |
| D | StatCard size variant | Four hand-rolled Tile widgets show 18px values where Dashboard shows 28px; operator scrolling sees two visual languages for the same widget. (UI #2, inconsistent) |
| D | Sidebar emoji actually unified | Phase 8 commit claimed unification but audit found 12 colored + 5 monochrome side-by-side. (UI #5, looks-bad) |
| D | TONE_PALETTE adoption | Phase 9 WS-E exported TONE_PALETTE; two highest-traffic detail pages still re-declare severity palettes inline. (UI #6, inconsistent) |
| E | MFA login gate | Phase 9 shipped enrollment but no gate; the operator can enroll, then continue signing in as if nothing happened. Cyber-insurance / HIPAA fail — the audit-row attestation is meaningless until the gate enforces. (gap from Phase 9 deferred follow-up; Phase 9 §11 explicitly sequenced this last) |

## 3. Workstream A — Phase 9 loop-closure

### 3.1 pcc2k-agent verb handlers

New Go files under `cmd/agent/`:

- `shell_handler.go` — runs `powershell.exe` on Windows, `bash`
  on Linux/macOS; hooks stdin/stdout/stderr to a WSS stream
  channel identified by sessionId. Reads incoming `shell.input`
  frames, writes to the running process's stdin. On process exit
  OR `shell.close` from server, emits a `shell.exited` envelope
  with exitReason + byte counts.
- `file_handler.go` — handles `file.push { transferId, remotePath,
  signedUrl, expectedSha256 }` by fetching the URL via HTTPS
  client, writing to remotePath, computing sha256, emitting
  `file.transfer.complete`. `file.pull { transferId, remotePath }`
  reads + chunked-uploads to a FleetHub-side endpoint, emits
  the same completion envelope.
- `backup_handler.go` — handles `backup.trigger { runId, product }`
  by dispatching to per-product binary:
  - "restic" → `restic backup ${RESTIC_REPO} ${target-paths}`
  - "wbadmin" → `wbadmin start backup -backupTarget:${path} -include:${target}`
  - "veeam" → `veeam.backup --runJob ...`
  - "datto" → contacts local Datto agent CLI
  - "windows-backup" → wbadmin path again (alias)
  Captures exit code; emits `backup.complete` with state + errorMsg.
  Per the Phase 8 posture-detector pattern, each product is detected
  at startup; if the product binary is absent, the handler
  immediately emits `backup.complete state="failed"`.

Audit-trail integration: every handler emits to the existing
`Op_AuditLog` table on agent side AND every callback envelope
generates a `Fl_AuditLog` row on FleetHub side via the new ingest
handlers below.

### 3.2 Three new ingest envelope handlers

In `lib/agent-ingest.ts`:

```typescript
// New cases added to the existing 11-method discriminator.
case "shell.exited": {
  const { sessionId, exitReason, bytesTx, bytesRx } = parsed
  await prisma.fl_ShellSession.update({
    where: { id: sessionId },
    data: {
      state: exitReason === "operator" || exitReason === "timeout" ? "closed" : exitReason,
      closedAt: new Date(),
      exitReason,
      bytesTx, bytesRx,
    },
  })
  await writeAudit({
    action: "shell.exited",
    outcome: exitReason === "error" ? "error" : "ok",
    detail: { sessionId, exitReason, bytesTx, bytesRx },
  })
  break
}
case "file.transfer.complete": {
  const { transferId, state, sha256, sizeBytes, errorMsg } = parsed
  await prisma.fl_FileTransfer.update({
    where: { id: transferId },
    data: { state, sha256, sizeBytes, errorMsg, completedAt: new Date() },
  })
  await writeAudit({ action: "file.transfer.complete", outcome: state === "completed" ? "ok" : "error", detail: parsed })
  break
}
case "backup.complete": {
  const { runId, state, errorMsg } = parsed
  await prisma.fl_BackupRun.update({
    where: { id: runId },
    data: { state, errorMsg, completedAt: new Date() },
  })
  await writeAudit({ action: "backup.complete", outcome: state === "completed" ? "ok" : "error", detail: parsed })
  break
}
```

Plus a zod schema variant per envelope in `lib/agent-ingest-envelopes.ts`.

### 3.3 xterm.js modal UI

New `app/(protected)/devices/[id]/ShellModal.tsx`. Renders an
xterm.js terminal in a fullscreen modal when the operator clicks
"Open shell" on the remote tab. Streams output via SSE from a new
`/api/admin/shell-sessions/[id]/stream` endpoint (server-side
maintains a 1MB ring buffer per session; on connect, replay the
buffer first then stream live). Input via POST to
`/api/admin/shell-sessions/[id]/input` (audited per-keystroke?
no — per-input-frame, batched at ~50ms).

xterm.js fitAddon for resize-aware terminal sizing. Close button
+ session-expires countdown in the modal header.

Per design §10, the modal does NOT record content. The audit row
captures session open/close + byte counts; full keystroke-record
is Phase 11+ if HIPAA requires.

### 3.4 Tenant-settings UI

New tab on `/clients/[name]?tab=advanced`. Renders the 10 toggles
in a 2-column grid with each one's blurb + link to the related
feature page. Server action saves to Fl_Tenant via PATCH to a
new `/api/admin/tenants/[name]/advanced` route (audited).

Sectioned for readability:
- Security & access: mfaRequired
- Backup: backupTriggerEnabled + backupTriggerRequiresJustification
- Shell sessions: shellSessionsEnabled + shellRequiresJustification + shellMaxDurationMin
- File transfer: fileTransferEnabled + fileTransferRequiresJustification + fileTransferMaxSizeMb
- Integrations: psaSyncEnabled

### 3.5 Fl_DeviceGroup wire-in

Three dispatch routes accept a new optional parameter:

```typescript
// POST /api/deployments — add targetGroupId
{ targetGroupId?: string }
// When set, server: const ids = await resolveGroupTargets(targetGroupId)
// substitute into targetDeviceIds before createDeployment.

// POST /api/scripts/[id]/run — add groupId
{ groupId?: string }
// When set, fan-out runScript per resolved device.

// POST /api/patches/[id]/deploy — add groupId
{ groupId?: string }
// When set, fan-out per resolved device.
```

UI changes:
- DeploymentForm.tsx: "Use group" dropdown above the device table.
  On select: call `/api/admin/device-groups/[id]/preview` (new
  read-only endpoint) to fetch the resolved devices, pre-check
  them in the table, render a freeze badge + "manual override" toggle.
- New `ScriptRunDialog.tsx` (consolidates the existing
  /scripts/[id]/run page UI as a modal). Includes the group picker.
- /patches/[id] PatchDeployForm.tsx: same group-picker shape.

### 3.6 Sequencing inside WS-A

The architect's gut-check called out a non-obvious order:

1. **Ingest envelope handlers land first** (lib/agent-ingest.ts).
   The pcc2k-agent commits emit these envelopes; without the
   handlers, agent-side commits cause 400s in prod.
2. **xterm.js modal + tenant-settings UI** — independent of agent;
   can ship in parallel.
3. **pcc2k-agent commits** — after step 1 is live in prod.
4. **Fl_DeviceGroup wire-in** — independent; can ship anytime.

## 4. Workstream B — Hardening continuation

### 4.1 Audit-chain hashRow dedup

Move `hashRow` from `lib/audit.ts` to `lib/audit-chain.ts`. Export
from `audit-chain.ts`; `audit.ts` imports + re-exports for
back-compat with existing callers. The two implementations are
byte-identical today; this enforces it structurally.

### 4.2 agent-ingest reject-path audits

Three new `writeAudit` calls in `app/api/agent-ingest/route.ts`:
- HMAC verification failed (signature mismatch / missing headers /
  outside replay window) → `action: "agent.ingest.rejected"`,
  `outcome: "error"`, `detail: { reason }`
- JSON parse failed → same shape with reason "invalid JSON body"
- Missing required envelope fields → same shape with the zod issues

Brute-force probes leave a trail. Cron + offline analysis can spot
ramping rejection rates.

### 4.3 Read-side zod safety — 6 columns

Six new `safeParse*Json` helpers in `lib/schemas/`:

```typescript
// lib/schemas/predicate.ts
export function safeParseMonitorPredicateJson(json: string): SafeParseResult<MonitorPredicate>
// lib/schemas/channels.ts
export function safeParseChannelsJson(json: string): SafeParseResult<ChannelConfig[]>
// lib/schemas/escalation.ts
export function safeParseEscalationJson(json: string): SafeParseResult<EscalationStep[]>
// lib/schemas/delivery.ts
export function safeParseDeliveryJson(json: string): SafeParseResult<DeliveryConfig>
// lib/schemas/device-group.ts
export function safeParsePinnedDeviceIdsJson(json: string): SafeParseResult<string[]>
// lib/schemas/inventory.ts
export function safeParseInventoryJson(json: string): SafeParseResult<InventorySnapshot>
```

Adopted at 15+ callsites (per the audit grep). Malformed inputs
write a `*.skip.malformed` audit row + degrade gracefully.

### 4.4 alert-escalator n+1 fix

Batch the per-group lookups. Currently:

```typescript
for (const group of dueGroups) {
  const route = await prisma.fl_AlertRoute.findUnique(...)  // n+1
  const count = await prisma.fl_AlertDispatch.count(...)    // n+1
  ...
}
```

After:

```typescript
const routeIds = Array.from(new Set(dueGroups.map(g => g.routeId)))
const routes = await prisma.fl_AlertRoute.findMany({ where: { id: { in: routeIds } } })
const routeMap = new Map(routes.map(r => [r.id, r]))
const counts = await prisma.fl_AlertDispatch.groupBy({
  by: ["alertId"], where: { alertId: { in: alertIds }, ... }, _count: true,
})
const countMap = new Map(counts.map(c => [c.alertId, c._count]))
for (const group of dueGroups) {
  const route = routeMap.get(group.routeId)
  const count = countMap.get(group.alertId) ?? 0
  ...
}
```

Same shape as Phase 9's monitor-evaluator fix.

### 4.5 Five vitest files

- `tests/audit-chain.test.ts` — insert N rows → verify → tamper 1
  → verify reports broken-at-row-N. Cover both append-only and
  full-chain verification paths.
- `tests/mfa.test.ts` — RFC 6238 TOTP test vectors (deterministic
  secret/time/expected-code triples). Recovery-code consume-once
  semantics (consume, verify same code now fails).
- `tests/monitor-evaluator.test.ts` — cooldown blocks second fire
  inside window; sustain semantics (every sample must violate);
  batched lookup correctness with mixed-tenant devices.
- `tests/runbook-predicate.test.ts` — exitCode equality + range;
  stdoutContains case-insensitive + multi-line; stdoutRegex with
  flags + anchors.
- `tests/alert-channels/index.test.ts` — preflight returns null on
  valid config + reason string on missing config per adapter (6
  channels × 2 branches = 12 cases). Send path mocked.

### 4.6 Sequencing inside WS-B

No internal dependencies. Items can ship in any order. Recommend:
audit-chain dedup first (highest silent-failure-risk), then zod
sweep (largest surface), then n+1, then tests.

## 5. Workstream C — Operator power tools

### 5.1 Saved views

Schema is already there: `Fl_StaffUser.savedViewsJson` (defined
in Phase 0). v1 shape:

```typescript
{
  alerts: [{ id, label, querystring, createdAt }],
  devices: [{ id, label, querystring, createdAt }],
}
```

Two pages get a "Save view" button next to their filter strip:
- `/alerts` — captures the current ?severity/state/client/q querystring
- `/devices` — captures ?q/client/os/online/role/sort

Saved-view chips render above the filter strip; click loads the
saved querystring. Delete via a small × on hover.

Cmd-K integration: new "Saved views" category surfaces all of the
operator's saved views with matching keyword.

### 5.2 Bulk-ack Undo toast

New `<Toast>` primitive in `components/ui/Toast.tsx`. Triggered by
a `useToast()` hook; tone (ok/warn/danger) + label + optional
action ({ label, onClick }) + timeout (default 6s, autocloses with
animation).

`bulkAckAlerts` server action returns the list of acked ids. Client
renders toast: "Acked N alerts · Undo". Action POSTs to new
`/api/admin/alerts/bulk-unack` route (audited) with the id list.

### 5.3 Deployments list filters + BulkBar

Mirrors `/devices` page Phase 9 work:
- Status chip filter (queued / running / paused / completed / aborted)
- Tenant chip filter (facets from active deployments)
- Row-checkbox column + sticky BulkBar with Pause / Resume / Abort
  buttons. Each button fans out to per-id routes; new
  `/api/admin/deployments/bulk-pause`, `/bulk-resume`, `/bulk-abort`
  wrapper routes for atomicity.

### 5.4 Audit log quick-range presets

Chip row above the existing filter form on `/audit`:
- Last 1h
- Last 24h
- Last 7d
- Last 30d

Click writes `from` (= now - delta) to the form + auto-submits.
Preserves the existing actor / action / outcome / device / client
filters.

### 5.5 On-call schedule TZ preview

Tenant-default-TZ pulled from new `Fl_Tenant.timezone` column
(IANA name, optional, defaults to America/New_York at server
startup). Each rotation slot's UTC HH:MM gets a "= local-TZ"
suffix on the same line:

```
Monday 09:00–17:00 UTC  = 05:00–13:00 America/New_York (-EST)
```

Override datetime-locals get the same treatment. Single
formatTzPreview helper in `lib/dates.ts`.

### 5.6 Fl_DeviceNote + Fl_TenantNote

New tables:

```prisma
model Fl_DeviceNote {
  id          String   @id @default(cuid())
  deviceId    String
  device      Fl_Device @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  body        String   // markdown
  isPinned    Boolean  @default(false)
  createdBy   String   // operator email
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?
  @@index([deviceId, deletedAt, isPinned])
  @@map("fl_device_notes")
  @@schema("fleethub")
}

model Fl_TenantNote {
  id          String   @id @default(cuid())
  tenantName  String
  body        String
  isPinned    Boolean  @default(false)
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?
  @@index([tenantName, deletedAt, isPinned])
  @@map("fl_tenant_notes")
  @@schema("fleethub")
}
```

UI:
- `/devices/[id]` summary tab: new "Notes" subsection. Pinned
  notes at the top (collapsed → expanded toggle), then chronological
  list. Inline "Add note" via a markdown textarea + Save button.
- `/clients/[name]?tab=notes` — same pattern at the tenant level.

CRUD via new `/api/admin/device-notes/[id]` + `/api/admin/tenant-notes/[id]`
routes, all audited via withAudit.

Markdown rendered safely (DOMPurify or marked + sanitize) — body is
operator-typed, but a paranoid sanitization pass is cheap.

### 5.7 Asset/warranty UI on /devices/[id]

Three fields editable when role >= TECH on the summary tab:
- `assetTag` (free-form text)
- `purchasedAt` (date picker)
- `purchasePriceCents` (cents → display as `$XX.XX`)

New `/api/admin/devices/[id]` PATCH route (audited). The Posture
card already exists from Phase 8; the Asset subsection sits next
to it.

### 5.8 "Warranty expiring 90d" report

New `getWarrantyExpiring(daysAhead = 90)` in `lib/reports.ts`:

```typescript
export async function getWarrantyExpiring(daysAhead = 90): Promise<WarrantyExpiringRow[]> {
  const cutoff = new Date(Date.now() + daysAhead * 86400_000)
  return prisma.fl_Device.findMany({
    where: {
      isActive: true,
      warrantyExpiresAt: { not: null, lte: cutoff },
    },
    select: {
      id: true, clientName: true, hostname: true,
      assetTag: true, purchasedAt: true,
      warrantyExpiresAt: true,
    },
    orderBy: [{ warrantyExpiresAt: "asc" }],
  })
}
```

Surfaces on `/reports` as a "Warranties expiring in 90 days" card
+ a CSV export via the existing report-export pipeline. New
`Fl_Report.kind = "warranty-expiring"` option in the existing
SUPPORTED_KINDS enum.

### 5.9 Sequencing inside WS-C

No hard ordering. Recommend by-friction-class:
1. Saved views (highest daily-pain, smallest scope).
2. Bulk-ack Undo (daily-pain).
3. Deployments BulkBar (daily-pain).
4. Audit presets + TZ preview (weekly-pain, fastest landings).
5. Notes tables (mid-scope, new schema).
6. Asset UI + warranty report (smallest, completes a Phase 9
   deferral pair).

## 6. Workstream D — Visual debt finish-line II

Sequencing — no internal dependencies. Recommend by-visibility:

1. patches `pill()` → Chip (highest-traffic surface)
2. Sidebar emoji unification + Phase-0-scaffold subtitle drop
   (single most-visible chrome)
3. StatCard size variant (4 Tile migrations)
4. TONE_PALETTE adoption (devices/[id] + alerts/[id])
5. Button adoption (6 helpers)
6. TYPOGRAPHY.H1 enforcement (3 sites)
7. TH/TD sweep (mechanical)

Each is a sub-day PR. Total work ~2 days; can ship between bigger
WS-A/B/C items as calendar permits.

## 7. Workstream E — MFA login gate (standalone, last)

### 7.1 New /mfa-challenge page

`app/(public)/mfa-challenge/page.tsx` (outside the `(protected)`
group so it's reachable mid-flow). After Azure AD callback marks
the session, NextAuth's `jwt` callback writes `mfaCleared = false`
when the user's `totpEnabledAt` is set.

The challenge form:
- 6-digit TOTP input (default)
- "Use a recovery code" link → toggles input to recovery-code
  format
- Submit → POST `/api/auth/mfa-verify` with `{ token | recoveryCode }`
- On success: server flips `session.mfaCleared = true`, redirects
  to original destination
- On fail: error message, form remains; 3 wrong attempts → 60s
  cooldown

### 7.2 Session middleware

`middleware.ts` (root-level) intercepts protected-route requests.
Pseudo-code:

```typescript
export async function middleware(req: NextRequest) {
  const token = await getToken({ req })
  if (!token) return NextResponse.redirect("/login")

  // Phase 10 WS-E — MFA gate
  const user = await prisma.fl_StaffUser.findUnique({ where: { id: token.id }})
  const tenant = ... // resolve via user's primary tenant
  const mfaRequired = (user?.totpEnabledAt != null) || (tenant?.mfaRequired === true)
  const mfaCleared = token.mfaCleared === true

  if (mfaRequired && !mfaCleared) {
    return NextResponse.redirect(`/mfa-challenge?next=${encodeURIComponent(req.nextUrl.pathname)}`)
  }
  // forced-enrollment path
  if (mfaRequired && user?.totpEnabledAt == null) {
    return NextResponse.redirect(`/setup/staff/${user.id}?tab=mfa&forced=1`)
  }
}
```

### 7.3 Tenant-required forced enrollment

When `Fl_Tenant.mfaRequired` flips true and a user has no
`totpEnabledAt`, sign-in redirects to `/setup/staff/[id]?tab=mfa`
with a `forced=1` banner: "Your tenant requires MFA. Enroll now to
continue."

The user CANNOT reach a protected route until enrollment completes.
On enroll-verify success, session is reissued with `mfaCleared`.

### 7.4 Audit rows

- `mfa.challenge.ok` — successful TOTP entry
- `mfa.challenge.fail` — wrong code (rate-limited path)
- `mfa.challenge.recovery-used` — recovery code consumed
- `mfa.enrollment.forced` — tenant mfaRequired triggered redirect
- `mfa.tenant.required-enabled` / `disabled` — when an admin
  flips the tenant flag

### 7.5 Sequencing

WS-E ships last in Phase 10. The auth contract change affects
every other workstream's `getSessionContext()` callers; doing it
after WS-A/B/C/D have landed means the gate doesn't accidentally
block the operator's mid-phase work.

## 8. Shared infrastructure

- The `<Toast>` primitive from WS-C 5.2 is also a candidate for
  WS-A's tenant-settings save action. Land WS-C 5.2 first if WS-A
  needs a save-success toast.
- WS-B's read-side zod helpers are consumed by WS-A's group
  resolver if the resolver wants to validate `pinnedDeviceIdsJson`
  on every resolve. Either order works.
- WS-E's middleware redirects need a fallback for `/api/*` routes
  — those return 401 JSON not a redirect. Document the split.

## 9. Schema additions (full delta vs Phase 9)

New models:
- `Fl_DeviceNote` (WS-C 5.6)
- `Fl_TenantNote` (WS-C 5.6)

`Fl_Tenant` additions:
- `timezone` (String?, defaults to America/New_York at app
  level — IANA name)

`Fl_Report` additions:
- New value in the existing `kind` enum / supported-kinds list:
  `"warranty-expiring"`

No changes to existing Phase 9 tables.

## 10. Optional integrations + per-deploy decisions

- **xterm.js** for the modal terminal — chosen over hand-rolling.
  ~150KB gzip, ANSI support, copy-on-select, paste, fit-on-resize.
- **DOMPurify or marked + sanitize** for markdown notes — chosen
  to avoid XSS via operator-typed notes. ~12KB. If operators turn
  out to never need formatting, swap to plain text in v1.5.
- **Sidebar emoji family** — operator picks at PR time between
  monochrome-unicode-glyphs OR a fully consistent emoji set.
  Phase 8 §14 voice rule was "emoji-monochrome"; the colored
  emoji are the strays. Decision pending.

## 11. Sequencing across workstreams

The hard ordering constraints:

1. **WS-A 3.2 ingest envelope handlers** BEFORE pcc2k-agent
   commits — emitting the new envelopes against a server that
   doesn't parse them causes 400s in prod.
2. **WS-E MFA gate** ships LAST — auth-contract change every
   other WS depends on.
3. **WS-A 3.5 Fl_DeviceGroup wire-in** can ship anytime independent
   of the rest of A.
4. **WS-B 4.1 audit-chain dedup** is risk-class-isolated from
   everything else; can ship first or last as calendar permits.

Recommended order:

1. WS-D (visual debt II) — low-risk, can ship in parallel with
   anything; let it run as background between bigger items.
2. WS-B (hardening) — five-item workstream, ships in any order
   internally. Land audit-chain dedup first since highest stakes.
3. WS-A 3.2 ingest handlers — must precede agent commits.
4. WS-C 5.1-5.4 + 5.6 (saved views, bulk-ack, deployments,
   audit-presets, on-call TZ, notes) — interleaves with A.
5. WS-A 3.1 + 3.3 + 3.4 + 3.5 — agent verbs, xterm, tenant
   settings, group targeter.
6. WS-C 5.7 + 5.8 — asset UI + warranty report (completes the
   Phase 9 deferral pair).
7. WS-E — MFA gate, last.

Each workstream is independently shippable; the dependencies above
are the only hard constraints.

## 12. Open questions

- **xterm.js stream resilience.** Operator's browser tab loses
  network for 5 seconds — does the SSE reconnect cleanly with
  buffer replay? v1 ships the basic ring-buffer approach;
  reconnect-with-resume-token deferred to v1.5 unless an operator
  reports drops.
- **Notes markdown surface** — full GFM (tables, task lists) or
  basic (bold, links, lists, code)? v1 ships basic; tables + task
  lists are operator-friction and v1.5 if asked.
- **Saved-views column-ordering persistence** — current Phase 9
  saved-views schema captures only the URL querystring. Column
  width / order persistence is a follow-up; the schema column is
  JSON so extending the shape is non-breaking.
- **`Fl_Tenant.timezone` default** — fall back to America/New_York
  at server startup? Or read TZ from the host environment? v1 picks
  hard-coded fallback; operator overrides per-tenant.
- **MFA challenge backoff** — exponential or fixed? v1 picks fixed
  60s after 3 fails; exponential if operators report grinding
  attacks.

## 13. Non-goals (out of scope for Phase 10)

Honored from the architect's gut-check — these items were proposed
for Phase 10 but pulled because they're either too heavy for a
follow-up phase OR they belong in a crypto-heavy bundle:

- **Network device monitoring (SNMP / ICMP).** Phase 9 §13 named
  this as Phase 10; architect counter-pulled because SNMP v3
  community-string/cred encryption is the same crypto infra as
  credential vault — pair them in Phase 11 to amortize key
  management. Naming this here as Phase 11 territory.
- **Credential vault per client.** Same Phase 11 home.
- **WebAuthn / passkeys.** Pairs with credential vault. Phase 11.
- **4-eyes approval workflow** (Fl_ActionApproval). Policy primitive
  with schema + UI + workflow + which-actions-require + escalation-if-
  approver-absent. Half-workstream by itself + must land before
  shell.open ships unguarded, which means it blocks WS-A. Phase 11.
- **Process / service inspector on /devices/[id].** Audit said
  UI-only, but AGENT-PROTOCOL.md says `windows.services.*` is
  OpsHub-owned. Crosses the namespace boundary the protocol
  forbids. Pulled pending a design conversation about whether
  FleetHub gets its own `fleet.services.*` namespace.
- **Recurring tenant maintenance windows.** Phase 9 §13 named.
  Cron-schedule UX overlaps with monitor + runbook cadence +
  scheduled reports; deserves own design pass. Phase 11.
- **Content-recording shell sessions.** Privacy infra. Phase 11+
  alongside credential vault.
- **Mutable AV/EDR management.** Phase 11+.
- **AI alert correlation / root-cause clustering.** Long-haul.
- **White-label / multi-MSP federation.** Long-haul.
- **PSA-out adapters beyond TicketHub** (ConnectWise / Halo /
  Autotask). Per-vendor adapter pattern mirroring Phase 8 inbound
  mappers; defer until an operator brings one of those PSAs.
- **Custom monitor expressions beyond the 6 metric kinds.** Bigger
  surface than it looks; expression parser + validation + grammar.
- **Bulk action runner / Fl_FleetQuery / saved fleet filters
  beyond saved views.** WS-C ships querystring-saving; ad-hoc
  cross-page runs deferred.
- **Time-tracking on Fl_RemoteSession + Fl_ScriptRun.** PSA-adjacent.
- **Per-tenant site-survey PDF.** Branding-tab pairing; deferred.
- **CMDB relationships** (Fl_DeviceLink). Defer to topology / map
  feature in a later phase.

## 14. Voice check

Voice: Phase 10 is the phase where FleetHub stops feeling like
"Phase 9 mostly shipped — modulo agent verbs" and starts feeling
like "the loops are closed; the operator works through them, not
around them." Every WS-A decision answers "did Phase 9 actually
ship end-to-end?" Every WS-B decision answers "did Phase 9's
hardening pass leave anything visible?" Every WS-C decision
answers "can the operator finish their daily routine without 4-
click rituals or rebuilding state?" Every WS-D decision answers
"does the chrome still drift from primitive?" Every WS-E decision
answers "is the MFA we shipped in Phase 9 actually enforced?"

No new dispatched agent verb without a matching ingest envelope
handler. No new admin POST/PATCH/DELETE without `withAudit`. No
new `JSON.parse(x) as Y` — `safeParse*` only. No new hand-rolled
`pill()` / `Tile` / `btnPrimary` / inline severity ladder. No new
column added to the audit canonical hash without touching both
sides of the dedup. The phase is about discipline pulling Phase 9
all the way through to the end.
