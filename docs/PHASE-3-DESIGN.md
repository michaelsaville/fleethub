# FleetHub Phase 3 — Software Deployment (Design)

**Status:** Draft, 2026-05-02. Not yet implemented. Phase 3 is gated on Phase 2 (script orchestration) shipping the capability-drop + signed-body machinery — Phase 3 piggybacks on both.

**Scope of this doc:** the design contract for `software.*` namespace methods, the package + version model, rollout rings, reboot policy, the deploy-monitor live-progress view, and the schema additions. The design point is **technician flow**: every decision below traces back to a "techs love this / techs hate that" finding from the field research, and every screen is meant to keep the operator in motion rather than click-modal-click-modal.

**Cross-references:**
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) §8 — `software.*` namespace ownership
- [`PHASE-2-DESIGN.md`](PHASE-2-DESIGN.md) — capability model + dry-run pattern Phase 3 inherits
- [`HIPAA-READY.md`](HIPAA-READY.md) §6 — signed-body enforcement also applies to custom MSIs
- [`UI-PATTERNS.md`](UI-PATTERNS.md) — Cmd-K, hyperlink-every-number, no-buried-config conventions Phase 3 must respect

---

## 1. What Phase 3 ships

Per FleetHub `README.md`:

> Phase 3 — Software deployment. Adds `software.*` namespace, winget + Chocolatey + Homebrew passthrough, custom MSI/PKG upload, canary→wave→full rollout with halt-on-failure, version drift surfacing, reboot policy that respects clinical context.

Concretely, by the end of Phase 3:

- A tech can hit Cmd-K, type `deploy chrome acme`, hit Enter, and have a canary install kicked off across the matching fleet without ever opening a wizard.
- Every deploy flows through a named **Update Ring** (canary → wave 1 → wave 2 → full) with auto-promote thresholds and circuit-breaker abort. Per-client ring overrides supported.
- Custom MSI / PKG / DEB uploads parse `ProductCode` / `UpgradeCode` / version automatically and suggest silent flags. No "go write a wrapper script."
- The `/software` inventory page shows version drift inline — "Chrome 122 (47 hosts), 119 (3 hosts)" — and the "3 hosts" is a one-click target picker for the next deploy.
- A deploy-monitor view streams live per-host status (47 done · 2 failed · 1 pending) with **inline stderr** on each failed row and per-row retry. No 4-click drill into per-host job logs.
- After every deploy, the agent re-runs `inventory.software` so drift state reflects ground truth in seconds, not at the next 60-min check-in.
- **Maintenance Mode** on the device detail page suppresses both alerts and deployments — a single toggle, walk-away-safe for clinical workstations during procedure windows.
- HIPAA-tenant deploys are dry-run-by-default and signed-body-enforced; the operator must explicitly opt out per deployment.

## 2. The pain points this design is built around

Six design choices below trace directly to specific failures observed in the incumbents. Documenting them here so the rationale survives implementation:

| Decision | Counters this RMM failure |
|---|---|
| Re-inventory immediately after deploy completes | NinjaOne / Datto reporting "patch deployed successfully" while inventory still shows old version → tech doesn't trust the dashboard |
| Aggregate header + inline-expandable failure rows | Datto's 4-click drill (device → jobs → run → stdout) per failed host kills rollout context |
| First-class Update Rings with named gates | Most RMMs have rollouts as "fire and forget" — no real circuit breaker |
| MSI upload parses metadata + suggests silent flags | Datto / ConnectWise Automate make custom MSIs "go write a Component script" |
| Maintenance Mode flag on the device, not in a policy | Datto's "schedule reboot at specific time" doesn't account for "clinical user just walked into exam room" |
| Force-check-in / re-detect button always reachable | Universal "trust restorer" — when techs disagree with the dashboard, they want a button |

## 3. The package + version model

The catalog has three package sources, all fronted by a unified `Fl_Package` row so the deploy UI doesn't fork by source:

```prisma
model Fl_Package {
  id            String   @id @default(cuid())
  tenantId      String   // packages are tenant-scoped
  name          String   // human-friendly: "Google Chrome"
  category      String   // "browser" | "office" | "security" | "vertical" | …
  source        String   // "winget" | "choco" | "brew" | "custom"
  sourceId      String   // winget pkg id, choco id, brew formula, or "custom:<cuid>"
  os            String   // "windows" | "macos" | "linux" | "any"
  scope         String   // "machine" | "user"
  dryRunCapable Boolean  @default(true)
  rebootPolicy  String   // "never" | "defer-if-user-active" | "force" | "schedule-window"
  signedBody    Boolean  @default(false)  // Ed25519 sig verified at deploy
  bodySha256    String?                   // for custom only
  bodyEd25519Sig String?                  // HIPAA tenants required
  vendorMetadata Json?   // ProductCode, UpgradeCode for MSI; bundleId for PKG
  silentInstallArgs String?               // suggested at upload time
  silentUninstallArgs String?
  detectionRule Json     // see §3.2
  createdAt     DateTime @default(now())
  archivedAt    DateTime?
  versions      Fl_PackageVersion[]
}

model Fl_PackageVersion {
  id          String   @id @default(cuid())
  packageId   String
  package     Fl_Package @relation(fields: [packageId], references: [id])
  version     String   // "122.0.6261.95" — string, not parsed (vendor formats vary)
  releaseDate DateTime?
  /** Custom only: the bytes/URL the agent will download. */
  artifactUrl String?
  artifactSha256 String?
  /** Server-pinned approved version. Deploys default to this when not overridden. */
  isApprovedDefault Boolean @default(false)
  createdAt   DateTime @default(now())
}
```

### 3.1 One package, three sources, one row

A request like "deploy Google Chrome to Acme fleet" should not require the tech to know whether Chrome lives in winget, choco, or as an uploaded MSI. Cross-source deduplication is curator-driven: PCC2K maintains a tenant-default catalog where Chrome is **one** `Fl_Package` row with source preference order (`winget` → `choco` → `custom` fallback). Per-OS rows are separate (Windows Chrome ≠ macOS Chrome) — we don't try to virtualize the OS axis, only the source axis within a single OS.

### 3.2 Detection rules

Detection answers "is this package installed at this version on this host?" — a primitive needed for both **drift detection** (inventory side) and **idempotent deploy** (skip the install if already present).

```jsonc
// Fl_Package.detectionRule
// Fired before the install attempt. Agent returns matched: bool + version.
{ "kind": "msi-product-code",
  "productCode": "{83C7D7AF-...-CHROME-MSI-CODE}" }

{ "kind": "registry-uninstall-key",
  "displayName": "Adobe Acrobat Reader DC" }

{ "kind": "file-version",
  "path": "C:\\Program Files\\App\\app.exe",
  "minVersion": "1.2.3" }

{ "kind": "winget-list",
  "packageId": "Google.Chrome" }

{ "kind": "brew-list",
  "formula": "google-chrome" }

{ "kind": "custom-script",
  "script": "powershell:Get-AppxPackage Microsoft.WindowsTerminal" }
```

The **PDQ pattern** is the gold standard here: when a custom MSI is uploaded, the agent's first deploy parses the MSI server-side to suggest a `msi-product-code` detection rule + `silentInstallArgs` from the MSI tables. The operator can accept-and-deploy without writing detection logic.

## 4. Method signatures (`software.*`)

Three server→agent methods + two notifications, all subject to Phase 2's capability-drop machinery.

### 4.1 `software.install`

```jsonc
{ "method": "software.install", "params": {
    "commandId": "<cuid>",
    "deploymentId": "<cuid>",        // groups commands across the deploy
    "package": {
      "id": "<Fl_Package.id>",
      "source": "winget",
      "sourceId": "Google.Chrome",
      "version": "122.0.6261.95",    // exact, server-pinned
      "scope": "machine",
      "silentInstallArgs": "/quiet /norestart",
      "artifactUrl": "https://…",    // present only for custom packages
      "artifactSha256": "abc…",
      "bodyEd25519Sig": "…"          // present only when signedBody=true
    },
    "detectionRule": { … },          // see §3.2
    "rebootPolicy": "defer-if-user-active",
    "dryRun": true,                  // default: true. Phase 2 dry-run rule.
    "timeoutSec": 1200,              // long install allowance
    "outputBytesCap": 65536
}}
```

Agent flow:
1. Run detection. If already installed at requested version → emit `software.complete` with `result: "no-op"` and exit.
2. If `source = custom` → fetch artifact, verify `artifactSha256`, verify `bodyEd25519Sig` if `signedBody=true`.
3. If `dryRun=true` → for winget/choco/brew, append `--whatif` / `--noop` flag where supported; for custom MSI, run `msiexec /a` (administrative install) which extracts but does not install. Emit `software.progress` lines describing what would have happened.
4. Otherwise execute. Stream `software.progress` notifications.
5. On completion: re-run detection. Emit `software.complete` with `result: "installed"|"updated"|"failed"|"reboot-required"|"reboot-deferred"` and the **detected post-install version**.

Step 5 is the anti-lying-status countermeasure: the agent verifies installation succeeded by re-detection before reporting success, period.

### 4.2 `software.uninstall`

Same envelope, `action="uninstall"`. Agent uses `Fl_Package.silentUninstallArgs` (or auto-derives for winget/choco/brew). Detection rule is fired post-uninstall to confirm absence.

### 4.3 `software.detect` (lightweight)

```jsonc
{ "method": "software.detect", "params": {
    "commandId": "<cuid>",
    "checks": [
      { "packageId": "<Fl_Package.id>", "rule": { … } },
      …  // batch up to 50 per call
    ]
}}
```

Used for **on-demand drift refresh** without running a full inventory. Fired by the deploy-monitor view's "Re-check" button and by post-deploy validation. Fast (no install, no download).

### 4.4 `software.progress` (notification, agent → server)

```jsonc
{ "method": "software.progress", "params": {
    "commandId": "<cuid>",
    "phase": "downloading" | "extracting" | "installing" | "verifying" | "rebooting",
    "percent": 47,                  // best-effort; null when not knowable
    "message": "Downloading 12.4 / 26.1 MB",
    "stream": "stdout" | "stderr",
    "data": "<utf-8 chunk>",
    "seq": 0
}}
```

Per Phase 2 §6: ≤4 KiB per frame, batched ≤200ms, backpressured.

### 4.5 `software.complete` (notification, agent → server)

```jsonc
{ "method": "software.complete", "params": {
    "commandId": "<cuid>",
    "result": "installed" | "updated" | "no-op" | "failed" | "reboot-required" | "reboot-deferred",
    "exitCode": 0,
    "durationMs": 47213,
    "detectedVersion": "122.0.6261.95",
    "rebootPending": false,
    "stderrTail": "<last 4 KiB of stderr>",  // inline so the UI doesn't drill
    "outputUrl": "s3://…",                   // null if under cap
    "outputSha256": "<hex>"
}}
```

`stderrTail` inline is non-negotiable — it directly counters the Datto 4-click drill failure mode. The deploy-monitor view shows this verbatim under each failed row.

## 5. Update Rings — the rollout primitive

Action1's pattern, distilled. A **Ring** is a named, reusable rollout shape with explicit gates between stages.

```prisma
model Fl_DeployRing {
  id            String   @id @default(cuid())
  tenantId      String
  name          String   // "Standard 4-stage", "Healthcare conservative"
  /** Per-stage device selector + auto-promote rules. */
  stages        Json
  isDefault     Boolean  @default(false)
  archivedAt    DateTime?
}

// Fl_DeployRing.stages JSON shape:
[
  {
    "name": "canary",
    "selectorKind": "pinned" | "filter" | "percentile",
    "selectorValue": [<deviceId>, …]  // when "pinned"
                  | { "rql": "client:Acme role:lab" }
                  | { "percent": 5, "from": "wave-1" },
    "abortFailureRate": 0.34,         // 1 of 3 fails → abort
    "autoPromoteAfterSec": 7200,      // 2h soak then auto-advance
    "requiresApproval": true          // human click between stages
  },
  { "name": "wave-1", "selectorKind": "percentile", … },
  { "name": "wave-2", "selectorKind": "percentile", … },
  { "name": "full",   "selectorKind": "remaining", … }
]
```

### 5.1 Canary picking — pinned, not random

Per the field research: random canary is essentially absent in commercial RMMs because techs don't trust randomness with clients. Default canary selectors are:

- **Per-tenant pinned** — a hand-picked group of "non-critical, technically friendly" hosts, usually internal IT machines + 1–2 power users per client. Editable on `/rings/[id]`.
- **RQL filter** — `client:Acme role:lab` — useful when canary is a *role*, not specific hosts.
- **Pure percentile** — available, but not the default.

### 5.2 Halt-on-failure circuit breaker

Each stage has an `abortFailureRate`. When the live failure rate during a stage exceeds it, the deployment auto-pauses. The deploy-monitor view banners red: "Auto-paused: 2/3 canary hosts failed. Resume to continue, or Abort to mark the deployment failed and re-detect drift."

Manual pause/resume is also available at any point. **In-flight commands at pause time complete naturally** — pause halts dispatch of *new* commands, doesn't interrupt running ones. Aborting kicks `software.uninstall` only on explicit operator confirmation; default abort is "stop here."

### 5.3 Per-client ring override

On `/clients/[id]`, a tech can pin a non-default ring for that client. The deploy form auto-uses the client's ring when targets land entirely within one client; it falls back to the tenant default for cross-client deploys. This counters the Action1-praised pattern of "Client A on aggressive ring + Client B (the dental practice) on conservative ring without forking the policy."

## 6. Reboot policy — situational, not just scheduled

The Datto failure mode: reboot-policy is a *time window*, not a *system state*. Phase 3's policy spans both:

```ts
type RebootPolicy =
  | { mode: "never" }                                  // post-deploy info banner only
  | { mode: "defer-if-user-active" }                   // skip if console session active
  | { mode: "force" }                                  // immediate, after notify
  | { mode: "schedule-window";                         // queue for next window
      windowCron: string;
      gracePeriodSec: number };                        // notify before reboot
```

Composed signals the agent checks for `defer-if-user-active`:
- Console session has logged-in user (Windows: WTSEnumerateSessions; Linux/Mac: `who`)
- Idle time < 30 minutes
- Any process matching `Fl_Tenant.protectedProcessNames` JSON list (default for healthcare tenants includes `Dentrix.exe`, `eClinical*.exe`, `Eaglesoft*.exe`)

When deferred, agent emits `software.complete` with `result="reboot-deferred"` and the host stays in a `pendingReboot=true` state. The next compatible window or explicit "Reboot now" command from the operator drains the pending state.

**Maintenance Mode on the device** (next section) is a hard override: maintenance-mode hosts never reboot from a deploy, period. Even `force` is suppressed.

## 7. Maintenance Mode — the clinical-safety toggle

NinjaOne's pattern, lifted because the alternative ("policy with time windows") doesn't survive a clinical user walking into a procedure room unscheduled.

```prisma
model Fl_Device {
  // … existing fields …
  maintenanceMode        Boolean   @default(false)
  maintenanceUntil       DateTime?  // null = indefinite
  maintenanceReason      String?
  maintenanceSetBy       String?    // operator email, for audit
}
```

When `maintenanceMode=true`:
- All `software.*` and `patches.*` commands queued for the host are paused, not dispatched.
- Alerts from the host are still ingested but tagged `suppressed=true`; they don't fire notifications.
- The host card on `/devices` shows a yellow "🔒 Maintenance" chip; clicking through shows the `maintenanceReason` and "set by" attribution.

UI surface: top-bar action on `/devices/[id]` (a real button next to Remote / Quick Job, not buried in a dropdown), and bulk-action on `/devices` ("Set 12 hosts to maintenance until 2026-05-09 17:00, reason: Q2 audit"). Indefinite-with-reason is allowed but warns at 7 / 30 / 90 days.

## 8. Live-progress UX — the deploy monitor

`/deployments/[id]` is the screen techs live in during a rollout. It's not a job-log page; it's a control surface.

```
┌────────────────────────────────────────────────────────────────┐
│ Deploying Google Chrome 122.0.6261.95 to Acme fleet           │
│ Standard 4-stage ring · Started 14:02 by mike                 │
│                                                                │
│ Canary  ████████  3/3   ✓ promoted 14:08  (no-op: 1)          │
│ Wave 1  ████░░░░  9/12  ⚠ 2 failed   (running)                │
│ Wave 2  pending                                                │
│ Full    pending                                                │
│                                                                │
│ [ ⏸ Pause ]  [ ⏭ Skip stage ]  [ ✋ Abort ]  [ 🔄 Re-detect ]  │
└────────────────────────────────────────────────────────────────┘

Live: 24 done · 2 failed · 9 pending · 1 reboot-deferred · 0 paused
                ▲ click any chip to filter the table below

[Filter: ✓ failed ☐ pending ☐ done ☐ reboot-deferred]   [search…]

┌────────────────────────────────────────────────────────────────┐
│ ✗ acme-ws-04   wave 1   failed   exit 1603  14:11             │
│   stderr: MSI: 1603 - Fatal error during installation.        │
│           Disk space C: 412 MB available; need 1 GB.           │
│           [ Retry ]  [ Re-detect ]  [ Skip this host ]         │
├────────────────────────────────────────────────────────────────┤
│ ✗ acme-ws-09   wave 1   failed   exit 5     14:11             │
│   stderr: Access denied. Group Policy CSE blocking install.    │
│           [ Retry ]  [ Re-detect ]  [ Skip this host ]         │
├────────────────────────────────────────────────────────────────┤
│ ⏳ acme-ws-12   wave 1   installing 67%  14:12                 │
│   Downloading 12.4 / 18.6 MB                                   │
└────────────────────────────────────────────────────────────────┘
```

Patterns this enforces:
- **Aggregate header + expandable failed rows.** No drill-into-detail-page-and-hunt-stderr.
- **Live counts as filters.** Click "2 failed" chip → table re-filters. Hyperlink-every-number rule from `UI-PATTERNS.md`.
- **Per-row retry.** No "rerun the whole deployment" — the dispatcher runs `software.install` only on the failed deviceId.
- **Re-detect button at every level** — top bar and per-row. Pokes the agent via `software.detect` and updates the row inline. Anti-lying-status countermeasure.
- **No mystery spinners.** Agents stream `software.progress.message` continuously; the row shows the last message ("Downloading 12.4 / 18.6 MB") instead of just "Installing…".

Backed by an SSE stream from the FleetHub server (or a websocket if the SSE proxy hop turns out to drop frames at scale). Initial implementation uses SSE — simpler infra, fits the Action1-style read-mostly traffic shape.

## 9. The deploy form — Cmd-K-first, modal-last

The flow techs love is:
```
⌘K → "deploy chrome acme" → ↵
   → /deployments/new?package=…&targets=…&ring=…
   → Form pre-filled. One confirm click. Done.
```

Cmd-K parses `deploy <package-fragment> <client-or-rql>` and resolves to a target package + target selection inline. The destination form has every field defaulted; the operator can tweak (version, ring, dry-run, schedule, reboot policy override) but the path-of-least-clicks is one click after Enter.

Fields on `/deployments/new`:

| Field | Default | Notes |
|---|---|---|
| Package | from Cmd-K | Searchable picker if Cmd-K didn't pre-fill. Shows source + scope + dryRunCapable + rebootPolicy inline. |
| Version | latest approved | Pinning available (dropdown with last 6 versions + "exact: …"). |
| Targets | from Cmd-K | RQL bar + chips (client / role / OS / online state) + saved Group dropdown. |
| Ring | client default → tenant default | Per-deployment override allowed. |
| Action | install | Install / Update / Uninstall. Update only enabled when package is currently installed at older version on at least one target. |
| Dry run | true | HIPAA tenants: confirmation required to flip off. |
| Reboot policy override | null (use package default) | Override panel collapsed; expand to set. |
| Schedule | "now" | "now" / "at <datetime>" / "during next maintenance window of each target". |
| Save targets as Group | unchecked | Inline name field; saves an `Fl_DeviceGroup` row for the current selection. |

The "Save these targets as a Group" is one of those tech-loved primitives that costs almost nothing to ship and dramatically compounds value across deploy-after-deploy use.

## 10. `/software` page — drift, not just inventory

Today's `/software` is rollup-oriented (top apps, heavy hosts, per-client). Phase 3 keeps that but inverts the primary surface to **drift**.

```
┌────────────────────────────────────────────────────────────────┐
│ Software · drift                                               │
│ 12 packages with version drift across 47 hosts                 │
│                                                                │
│ Google Chrome    122 (44 hosts)  119 (3 hosts)   [ Catch up ↗ ]│
│ Adobe Reader DC  24.001 (38)     23.006 (12)     [ Catch up ↗ ]│
│ 7-Zip            24.07 (23)      19.00 (24 EOL)  [ Catch up ↗ ]│
│ …                                                              │
│                                                                │
│ Tabs: Drift · Top apps · Heavy hosts · Per-client · Catalog    │
└────────────────────────────────────────────────────────────────┘
```

"Catch up" on a row navigates to `/deployments/new` with the package + target = "the off-version hosts" pre-populated. One click → review form → confirm → deploy. This is the entire value prop of drift detection — making the next action a single click.

The existing rollup tabs stay (top apps, heavy hosts, per-client) but become secondary tabs on the same page. The current `DeployModelCard` placeholder is replaced by the live drift view.

## 11. Custom MSI / PKG / DEB upload

`/packages/new` flow, PDQ-style:

1. **Drag-drop file** — agent-side artifact stored at `Fl_Package.artifactUrl` (S3-compatible, per-tenant prefix). Server computes `artifactSha256` immediately.
2. **Auto-parse** — server runs `msiinfo` (Linux) / `lessmsi` / `pkgutil --expand` against the upload. Extracts `ProductCode`, `UpgradeCode`, `ProductVersion`, default `silentInstallArgs` (e.g. `/quiet /norestart` for MSI, `-pkg <file> -target /` for PKG).
3. **Suggest detection rule** — pre-fills the detection rule with `kind=msi-product-code` + the parsed `ProductCode`. Operator can edit but the default is correct in 90%+ cases.
4. **HIPAA tenants: sign** — Ed25519-sign the artifact via the same YubiKey-touch flow as Phase 2 scripts. Signature stored in `bodyEd25519Sig`; agent verifies before install.
5. **Save** — package row created, archived state until the operator clicks "Approve for deployment."

Compare to Datto's "create a Component, set script type to Batch, write `msiexec` yourself, parameterize via Site/Global variables." The PDQ-style flow is three fields and a button.

## 12. Schema additions (full)

```prisma
model Fl_Device {
  // … existing fields …
  maintenanceMode        Boolean   @default(false)
  maintenanceUntil       DateTime?
  maintenanceReason      String?
  maintenanceSetBy       String?
  /** Set true when last deploy on this host returned reboot-deferred. */
  pendingReboot          Boolean   @default(false)
  pendingRebootSince     DateTime?
}

model Fl_Tenant {
  // … existing fields …
  protectedProcessNames  Json      @default("[]")  // string[]
  defaultRingId          String?
  defaultPackageRebootPolicy String @default("defer-if-user-active")
}

model Fl_Package           { … as §3 … }
model Fl_PackageVersion    { … as §3 … }
model Fl_DeployRing        { … as §5 … }

model Fl_Deployment {
  id              String   @id @default(cuid())
  tenantId        String
  packageId       String
  packageVersionId String
  ringId          String
  action          String   // "install" | "uninstall" | "update"
  status          String   // "queued" | "running" | "paused" | "completed"
                          //   | "aborted" | "auto-paused"
  dryRun          Boolean
  rebootPolicyOverride Json?  // RebootPolicy when overriding package default
  scheduledFor    DateTime?
  startedAt       DateTime?
  completedAt     DateTime?
  pausedAt        DateTime?
  pauseReason     String?
  requestedBy     String   // operator email
  totalTargets    Int
  succeededCount  Int      @default(0)
  failedCount     Int      @default(0)
  noOpCount       Int      @default(0)
  pendingCount    Int      @default(0)
  rebootDeferredCount Int  @default(0)
  targets         Fl_DeploymentTarget[]
}

model Fl_DeploymentTarget {
  id              String   @id @default(cuid())
  deploymentId    String
  deployment      Fl_Deployment @relation(fields: [deploymentId], references: [id])
  deviceId        String
  device          Fl_Device @relation(fields: [deviceId], references: [id])
  stageName       String   // "canary" | "wave-1" | …
  status          String   // "pending" | "running" | "succeeded" | "failed"
                          //   | "no-op" | "reboot-deferred" | "skipped"
  attemptCount    Int      @default(0)
  exitCode        Int?
  durationMs      Int?
  detectedVersionPre  String?
  detectedVersionPost String?
  stderrTail      String?  // last 4 KiB
  outputUrl       String?  // S3 if exceeded inline cap
  startedAt       DateTime?
  completedAt     DateTime?
}

model Fl_DeviceGroup {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  rql         String?  // dynamic membership
  pinnedDeviceIds Json @default("[]")  // string[] of static membership
  createdBy   String
  createdAt   DateTime @default(now())
}
```

## 13. Sequencing inside Phase 3

Bite-sized landings, each shippable:

1. **Schema + protocol freeze.** Land Prisma additions, `software.*` methods in `AGENT-PROTOCOL.md`, this design doc. Nothing executable.
2. **Catalog UX (read-only).** `/packages` list page, `/packages/[id]` detail. Seeded from a curated PCC2K base catalog (Chrome, Reader, 7-Zip, Office, Zoom, Teams). Custom upload flow stubbed.
3. **Detection-only.** Agent ships `software.detect`. The `/software` page flips its primary tab to **drift**. No installs yet — but the drift view is already useful as a read-only audit surface.
4. **Install path (winget / brew).** Agent ships `software.install` for native package managers. Single-host, no rings, no rollouts. Dry-run honored. Re-detect after deploy is the proof point.
5. **Custom MSI upload + install.** PDQ-style upload flow. Server-side parse via `msiinfo`. Per-host install verified.
6. **Update Rings + multi-host rollouts.** `/rings` CRUD. Deploy form gains target picker + ring selector. Live deploy-monitor view ships. Halt-on-canary-failure circuit breaker.
7. **Maintenance Mode + reboot policy.** `Fl_Device.maintenanceMode` toggle, situational reboot deferral, pendingReboot drain.
8. **Choco + Linux (apt/dnf).** Round out the source matrix. Linux is genuinely Phase 3.5 — most clinical fleets are Win + Mac.
9. **HIPAA-mode soak.** Flip `hipaaMode=true` on one tenant, prove signed-body enforcement holds for custom packages.

Each step is a shippable container restart. The drift view (step 3) is a UX win even before any deploys are possible — "you have 47 hosts on Chrome 119, three majors behind" is a sales-grade finding by itself.

## 14. Cmd-K command shape

For palette parsing (added to the existing Commands category):

```
deploy <package> [to <client|rql>]    → /deployments/new?package=…&targets=…
update <package> [on <client|rql>]    → "Update" action variant
uninstall <package> from <client|rql> → "Uninstall" action variant
maintenance <hostname> [for <duration>] → toggle Fl_Device.maintenanceMode
catch up <package>                     → /deployments/new?package=…&targets=<off-version hosts>
```

Cmd-K never executes a destructive action without one confirm screen — but the confirm screen has every value pre-filled. Tech types four words and clicks one button.

## 15. Audit shape

Every deployment writes 3-N rows to `Fl_AuditLog`:

- `software.deployment.create` — at queue time. Operator, package, version, action, ring, target count, dry-run flag.
- `software.deployment.stage-promote` — each stage advance. Auto vs manual, current success/fail counts.
- `software.deployment.command-complete` — one per target. result, exitCode, detectedVersionPre, detectedVersionPost.
- `software.deployment.pause` / `.resume` / `.abort` — operator actions during runtime.
- `software.deployment.maintenance-mode-set` — when a device flips into Maintenance Mode (separate audit row, not tied to a deployment).

Hash chain (`prevHash` / `rowHash`) per HIPAA-READY §2 unchanged — these new event types slot into the existing chain.

## 16. Open questions

- **Custom artifact storage.** S3-compatible is the obvious answer for `Fl_Package.artifactUrl`, but introduces a new ops surface. Alternatives: per-tenant Postgres LO, or local on-disk on the FleetHub server. Phase 2's `outputUrl` overflow has the same question — likely a coordinated decision. Lean toward MinIO running alongside DocHub's existing infra.
- **Cross-OS package abstraction (one row, multi-OS).** Today's design says "Windows Chrome and macOS Chrome are separate `Fl_Package` rows." A virtual `Fl_PackageFamily` parent could group them so Cmd-K `deploy chrome` resolves correctly across OSes without the operator picking a platform. Punt to Phase 3.5 — the field research suggests no incumbent does this well, so we're not behind.
- **License-aware deploys.** Office 365 ProPlus vs Standard, Adobe Acrobat Pro vs Standard. Currently out-of-scope; license tracking is its own beast and probably belongs in OpsHub (license inventory) rather than FleetHub (deploy mechanism). Phase 4+ — for now, tenants can encode license selection in `silentInstallArgs`.
- **Approval workflows.** "Deploy needs sign-off from a second admin before it runs." Not in v1 — defer until a HIPAA tenant explicitly asks. The audit log + signed-body enforcement covers most regulatory hand-wringing.
- **Multi-tenant package sharing.** Should a "PCC2K curated catalog" be visible across all tenants, or replicated per-tenant? Lean toward a `Fl_Package.tenantId IS NULL` curator-tier with per-tenant overrides. Decided when we have >1 tenant in production.
- **Reboot windows on Linux.** Linux servers often don't have console sessions, so `defer-if-user-active` doesn't apply. Default policy for Linux: `schedule-window` with cron `0 4 * * 0` (4am Sunday). Configurable per-tenant.
- **Bandwidth caps for big downloads.** Action1's P2P / LAN cache addresses this; we don't have it in v1. Mitigation: agents on the same `Fl_Device.network` (LAN-grouped) coordinate via gateway-mediated peer discovery. Phase 3.5+, after the basic deploy works.
- **Dry-run for custom MSI.** `msiexec /a` extracts but does not run InstallExecute scripts — close enough to "dry run" but doesn't catch e.g. "this MSI will fail because dep service is missing." Acceptable for v1; document the limitation.

## 17. Non-goals (out of scope for Phase 3)

- **Package version unwinding** ("we deployed Chrome 122; it broke; roll back the whole fleet to 121"). The mechanism is `software.uninstall` + `software.install` of the older version, but as a single user-facing "Roll back" button, that's Phase 3.5+.
- **Patch management.** Reserved for Phase 4. Even though the rollout-ring / live-monitor / reboot-policy machinery generalizes, patching has its own catalog (KB articles, third-party patch sources, deferral rules) that doesn't share enough with software deploy to fold in.
- **Cross-tenant rollouts** ("this Chrome update goes to all 12 tenants at once"). Each deployment is tenant-scoped. Cross-tenant ops live at the platform tier and aren't a tech-facing flow.
- **Approval routing** (multi-step approver chain). HIPAA tenants get signed-body + audit log; multi-approver is a Phase 4+ enterprise feature.
- **Software metering / license utilization.** OpsHub territory — counting Office seats vs licensed seats is identity-shaped, not operations-shaped.
- **In-place agent self-update.** Lives in pcc2k-agent repo and is its own design. Phase 3 deploys *third-party* software, not the agent itself.

These are valuable, just not Phase 3 valuable. The line is drawn at "what makes a tech's daily software-deploy flow great"; everything in §17 is an adjacent product surface.

---

**Voice check:** This doc tries to keep the same voice as PHASE-2-DESIGN.md — the spec IS the contract; deviations require updating this doc first. If you find yourself writing code that contradicts §3 or §6, edit the doc, get sign-off, then write the code.
