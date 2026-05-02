# FleetHub Phase 4 — Patch Management (Design)

**Status:** Draft, 2026-05-02. Not yet implemented. Phase 4 is the chunky one (~8–10 weeks). It's gated on Phase 3 (software deployment) shipping the rings + reboot-policy + deploy-monitor machinery — patch deploys reuse all of it.

**Scope of this doc:** the design contract for `patches.*` namespace methods, the multi-source catalog model (Microsoft + third-party + custom), CVE/KEV surfacing, multi-signal Windows detection, approval queue + per-CVSS auto-approval, maintenance windows, the rollback story, pre-patch safety gates, and the audit + compliance-reporting hooks Phase 5 consumes. Like the prior phase docs: the spec IS the contract; deviations require updating this doc first.

**Cross-references:**
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) §8 — `patches.*` namespace ownership
- [`PHASE-2-DESIGN.md`](PHASE-2-DESIGN.md) — capability model + dry-run pattern Phase 4 inherits
- [`PHASE-3-DESIGN.md`](PHASE-3-DESIGN.md) §5–9 — Update Rings, reboot policy, Maintenance Mode, deploy-monitor that patch deploys reuse without modification
- [`HIPAA-READY.md`](HIPAA-READY.md) §4–6 — encryption, signed-script enforcement (extends to custom-MSP patches), audit-log hash chain
- [`UI-PATTERNS.md`](UI-PATTERNS.md) — Cmd-K, hyperlink-every-number, no-buried-config conventions

---

## 1. What Phase 4 ships

Per FleetHub `README.md`:

> Phase 4 — Patch management. Adds `patches.*` namespace, third-party catalog, deferral windows, rollback, ring-based rollout (canary→wave→full), reboot policy hooks. The chunky one.

Concretely, by the end of Phase 4:

- A tech sees a fleet-wide CVE-driven dashboard ("47 hosts have CVE-2026-XXXX, marked KEV by CISA, closed by KB5036893") and one-click deploys the closing patch to the affected hosts via a Phase 3 ring.
- The catalog spans Microsoft (WSUS/Windows Update Catalog), a curated third-party feed (Adobe / Chrome / Zoom / 7-Zip / Java / etc.), and operator-uploaded custom MSP patches. Source rot (the WSUS supersedence problem) is auto-handled — superseded patches decline themselves on next sync.
- Every patch detection is **multi-signal**: agent runs `Get-HotFix` + `DISM /get-packages` + WU-history and reports the cross-check (counters the universal "installed but broken" trust-erosion event).
- Hotpatches (Server 2025 / Win11 KB-5068966-class) are flagged in the catalog and skip the reboot path entirely — clinical workstations stay clinical.
- Pre-patch gate runs before any deploy: disk-space check, free-RAM check, no-pending-reboot, backup-verified-in-last-24h (parses common backup-tool logs), Maintenance Mode honor (Phase 3).
- Rollback path tries `wusa /uninstall` → DISM removal → System Restore Point → VM snapshot rollback in that order. "What was deployed when" timeline survives so the operator knows which backup to restore even when scripted rollback fails.
- Per-client maintenance windows ("Acme: Tue/Thu 02:00-04:00 ET") with per-host snooze that has a hard ceiling.
- Compliance report endpoint emits per-host KB-by-KB matrix + SLA aging by CVSS band — the report Phase 5 hands an auditor.

## 2. The pain points this design is built around

Eight design choices below trace directly to specific failures observed in the incumbents. Each is a non-negotiable counter-pattern, not a nice-to-have:

| Decision | Counters this RMM failure |
|---|---|
| Multi-signal detection cross-check (Get-HotFix + DISM + WU history) | The universal "agent says installed, OS says no" trust-erosion event documented across MS Q&A on third-party RMM patch reporting |
| CVE/CVSS + CISA KEV inline on the patch row | NinjaOne / Action1 win deals on this; Datto / ConnectWise / Kaseya force you to leave the RMM to triage exposure |
| Real-time advisory ingest, not scheduled scans | The "minutes vs days" gap that sells modern tools — Datto's WUA breakage taking *months* to surface in the dashboard is the cautionary tale |
| Auto-decline on superseded patches | WSUS does NOT auto-decline; catalog grows unbounded, scans slow, hosts can be offered outdated KBs (Datto/CW/anything-WSUS-backed inherits this) |
| Layered rollback (wusa → DISM → restore point → VM snapshot) | Datto literally cannot uninstall Windows updates; `wusa /uninstall /quiet` deprecated; cumulative updates flagged "permanent" |
| Pre-patch backup gate (parses backup-tool logs for fresh good run) | Mature MSPs hand-roll this; making it first-class avoids the "we patched and the backup was broken" disaster pattern |
| Hotpatch lane that skips reboot entirely | Datto / SCCM / most RMMs treat hotpatch as just-another-patch; clinical-workstation-friendly RMMs surface it |
| Audit-chain on every patch op + least-privilege patch operator role | Kaseya VSA → REvil 2021: the RMM became the attack vector. Patch dispatch must require ADMIN + audit every step |

## 3. Patch catalog model

Multi-source, single-table-per-OS. The deploy form, drift view, and CVE dashboard all read one shape.

```prisma
model Fl_Patch {
  id              String   @id @default(cuid())
  /// "ms" (Windows Update / WSUS) | "thirdparty" (Adobe/Chrome/Zoom/...)
  /// | "custom" (operator-uploaded MSP patch)
  source          String
  /// Vendor-canonical id. KB number for MS ("KB5036893"); vendor product
  /// + version for third-party ("Adobe.Acrobat.DC@2025.001.20460");
  /// "custom:<cuid>" for uploads.
  sourceId        String
  os              String   // "windows" | "macos" | "linux" | "any"
  title           String
  /// "security" | "critical" | "definition" | "feature" | "rollup"
  /// | "driver" | "third-party"
  classification  String
  /// JSON: ["CVE-2026-XXXX", ...] when known. Empty for non-security.
  cveJson         String?
  /// Highest CVSS v3.1 base score across cveJson. 0-10. Null if unscored.
  cvssMax         Float?
  /// CISA Known Exploited Vulnerabilities flag — bumps priority hard.
  isKev           Boolean  @default(false)
  /// Server 2025 / Win 11 hotpatch — install without reboot.
  isHotpatch      Boolean  @default(false)
  /// PSWindowsUpdate `RebootRequired` semantic. Null when unknown.
  requiresReboot  Boolean?
  /// Patches this one supersedes. JSON: array of Fl_Patch.id strings.
  /// On approval, listed patches are auto-declined catalog-wide
  /// (counters WSUS supersedence rot).
  supersedesIdsJson String?
  /// Custom patches only: artifact + sig + detection.
  artifactUrl     String?
  artifactSha256  String?
  bodyEd25519Sig  String?  // HIPAA tenants required
  /// Detection rule (see §5.3). Multi-source; agent picks the
  /// applicable variant per OS.
  detectionRuleJson String?
  /// "approved" | "declined" | "needs-approval" | "deferred" | "auto-declined"
  approvalState   String   @default("needs-approval")
  approvedBy      String?
  approvedAt      DateTime?
  /// Operator note ("Acme defers to Apr quarterly window")
  notes           String?
  publishedAt     DateTime?
  ingestedAt      DateTime @default(now())

  installs        Fl_PatchInstall[]
  advisories      Fl_PatchAdvisory[]

  @@unique([source, sourceId])
  @@index([approvalState, isKev, cvssMax])
  @@index([os, classification])
}
```

### 3.1 Source federation

Three ingest pipelines, all writing into `Fl_Patch`:

- **Microsoft Update Catalog** — daily cron pulls from a WSUS-style upstream (we'll mirror what `Get-WUList` exposes via PSWindowsUpdate, plus the [Microsoft Update Catalog](https://catalog.update.microsoft.com/) HTML-scrape fallback for KB metadata). MS doesn't offer a clean public REST API — see open question §16.
- **Third-party catalog** — vendor-curated feed published by PCC2K (initially a Git-backed JSON file we update; eventually a partner feed from Patch My PC or similar). Format mirrors the Patch My PC schema so the eventual swap is a one-function change.
- **Custom MSP patches** — operator-uploaded MSI / EXE / MSU. Phase 3's `mockParseArtifact` flow extends to read MSU package metadata when `msiinfo` lands. HIPAA tenants enforce Ed25519 signature.

### 3.2 Supersedence

When patch A is approved and `A.supersedesIdsJson` lists patch B:
- B is auto-set to `approvalState="auto-declined"`.
- Pending deployments of B are aborted with reason `"superseded-by-${A.id}"`.
- Hosts that had B installed are NOT auto-rolled-back — supersedence applies to the *catalog*, not the *fleet*.

This counters the documented WSUS rot (catalog grows unbounded, slow scans, hosts offered outdated KBs).

## 4. CVE / advisory model

```prisma
model Fl_PatchAdvisory {
  id              String   @id @default(cuid())
  cveId           String   @unique  // "CVE-2026-XXXX"
  cvssBase        Float?
  cvssVector      String?
  isKev           Boolean  @default(false)
  kevAddedAt      DateTime?
  description     String?
  publishedAt     DateTime?
  /// Which patches close this CVE. Maintained by ingest cron.
  patches         Fl_Patch[]
  /// JSON: ["confidentiality","integrity","availability"]
  impactJson      String?
  ingestedAt      DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([isKev, cvssBase])
}
```

CVE ingest cron runs hourly:
- Pull NVD JSON 2.0 feed (delta only).
- Pull CISA KEV catalog (small, daily).
- Update `isKev` + `cvssBase` on existing advisories; create new rows on first sight.
- For each new CVE, scan `Fl_Patch.cveJson` + vendor-published patch-CVE mapping (MSRC) and link patches.

When a CVE flips from `isKev=false` to `isKev=true` and ANY linked patch isn't fully deployed, an alert fires (kind=`patch.kev.exposed`, severity=critical, deviceId enumerated from `Fl_PatchInstall` rows).

## 5. Method signatures (`patches.*`)

Five server→agent methods + three notifications, layered on Phase 2's capability-drop machinery and Phase 3's progress-streaming envelope.

### 5.1 `patches.scan`

```jsonc
{ "method": "patches.scan", "params": {
    "commandId": "<cuid>",
    /// Force a full re-scan (default: incremental since last scan).
    "fullRescan": false,
    /// Multi-signal detection — agent runs all three on Windows
    /// and returns the cross-check.
    "detectionMethods": ["wmi-qfe", "dism-packages", "wu-history"]
}}
```

Agent enumerates installed patches via the named methods, returns a structured per-method list, and bumps `Fl_Device.lastPatchScanAt`. Returns counts inline; full payload via `patches.report` notification (large).

### 5.2 `patches.detect`

```jsonc
{ "method": "patches.detect", "params": {
    "commandId": "<cuid>",
    /// Specific patches to verify (used by deploy pre-flight + post-flight).
    "checks": [
      { "patchId": "<Fl_Patch.id>", "rule": { … } },
      …  // batch up to 50
    ]
}}
```

Per-check returns `{ patchId, methods: { wmiQfe: bool, dismPackages: bool, wuHistory: bool }, consensus: "all-yes" | "all-no" | "disagreement" }`. The "disagreement" case is the high-value finding — it's exactly the "installed but broken" pattern the field research called out.

### 5.3 Detection rules

Multi-method per source on Windows; single-method elsewhere.

```jsonc
// Fl_Patch.detectionRuleJson
{ "kind": "windows-update",
  "kbId": "KB5036893",
  /// Methods the agent runs in order; results returned per-method.
  "methods": ["wmi-qfe", "dism-packages", "wu-history"] }

{ "kind": "msi-product-code",
  "productCode": "{83C7D7AF-...}",
  "minVersion": "2025.001.20460" }

{ "kind": "registry-uninstall-key",
  "displayName": "Adobe Acrobat Reader DC",
  "minVersion": "2025.001.20460" }

{ "kind": "file-version",
  "path": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "minVersion": "126.0.6478.62" }

{ "kind": "custom-script",
  "script": "powershell:Get-AppxPackage Microsoft.WindowsTerminal | …" }
```

### 5.4 `patches.deploy`

```jsonc
{ "method": "patches.deploy", "params": {
    "commandId": "<cuid>",
    "deploymentId": "<cuid>",        // groups commands across the deploy
    "patch": {
      "id": "<Fl_Patch.id>",
      "source": "ms",
      "sourceId": "KB5036893",
      "isHotpatch": true,
      "requiresReboot": false,
      "artifactUrl": null,           // null for MS; set for custom
      "artifactSha256": null,
      "bodyEd25519Sig": null
    },
    "preflightGate": {
      "minDiskSpaceGb": 15,
      "maxRamPercent": 90,
      "requireBackupWithinHours": 24,
      "requireNoPendingReboot": true
    },
    "rebootPolicy": "defer-if-user-active",
    "dryRun": true,
    "timeoutSec": 1800,
    "outputBytesCap": 65536
}}
```

Agent flow on receive:
1. Run pre-flight gate. Any failure → emit `patches.complete` with `result: "preflight-failed"` + reason. Don't attempt install.
2. If `dryRun=true` for MS patches, run `Get-WindowsUpdate -KBArticleID KBxxxxx -WhatIf`; for custom, do `msiexec /a` extract.
3. Otherwise install via the source-appropriate path (PSWindowsUpdate for MS, msiexec for custom MSI, direct EXE for vendor installers).
4. Stream `patches.progress` notifications.
5. **Re-run multi-signal detection** to verify success. Emit `patches.complete` with `result: "installed" | "no-op" | "failed" | "preflight-failed" | "reboot-required" | "reboot-deferred"` and the per-method consensus from §5.2.

Step 5 is the anti-lying-status guardrail. We never report `result: "installed"` if WMI says yes but DISM says no — that becomes `result: "failed"` with `failureReason: "detection-disagreement"` and an alert fires.

### 5.5 `patches.uninstall` (the rollback path)

```jsonc
{ "method": "patches.uninstall", "params": {
    "commandId": "<cuid>",
    "patchId": "<Fl_Patch.id>",
    "kbId": "KB5036893",
    /// Try in order; fail through to next on each failure.
    /// "vm-snapshot" only attempted when host has a hypervisor binding.
    "strategies": ["wusa", "dism-remove-package", "restore-point", "vm-snapshot"],
    "timeoutSec": 1800
}}
```

Agent attempts strategies in order. Reports per-strategy `success | declined-by-os | not-applicable | failed-with-error`. Final `patches.complete` with `result: "rolled-back" | "rollback-failed" | "rollback-partial"` and the strategy that worked.

The honest acknowledgment: rollback is 30% reliable scripting + 70% restore-from-backup. The deployment-history view (§9) makes the "which backup to restore" decision answerable in 5 seconds.

### 5.6 `patches.advisory.fire` (notification, agent → server)

```jsonc
{ "method": "patches.advisory.fire", "params": {
    "agentId": "<Op_Agent.id>",
    "kbId": "KB5036893",
    "publishedAt": "2026-05-02T...",
    "classification": "critical"
}}
```

Agent's local Windows Update API calls reveal a new patch the catalog hasn't ingested yet. We treat this as a hint — the next ingest cron run should pick it up regardless, but advisory.fire reduces "minutes vs days" lag for the first host to see it.

## 6. Rings — reused from Phase 3

Phase 4 deploys ride Phase 3's `Fl_DeployRing` + `Fl_Deployment` + `Fl_DeploymentTarget` infrastructure unchanged. The only Phase 4-specific addition is that the deploy form's package picker becomes a **patch picker** when invoked from a CVE row, and the deployment's `package` field becomes nullable + paired with `patch` (foreign key on `Fl_Deployment`).

Schema delta:

```prisma
model Fl_Deployment {
  // existing Phase 3 fields remain
  packageId    String?  // was non-null; now nullable
  patchId      String?  // new
  patch        Fl_Patch? @relation(fields: [patchId], references: [id])
  /// "software" | "patch"
  kind         String   @default("software")
}
```

Halt-on-failure circuit breaker, per-target retry, simulate-mode buttons, live monitor — all behave identically. The deploy monitor's failure-row stderr-tail format extends to show detection-disagreement errors readably.

## 7. Approval queue + per-CVSS auto-approval

New patches land as `approvalState="needs-approval"` and queue in `/patches/queue`. Operators triage:
- **Approve to ring** — picks an Update Ring (Phase 3) and starts a deployment.
- **Approve catalog-only** — patch can be deployed manually but isn't auto-rolled into any ring.
- **Decline** — patch is hidden from the catalog. Justification required for HIPAA tenants.
- **Defer** — set `deferUntil` date; resurfaces on date.

Per-tenant **auto-approve rules** cut the queue:

```jsonc
// Fl_Tenant.patchAutoApprovalJson
[
  { "criteria": { "isKev": true }, "action": "approve-to-ring", "ringId": "<id>" },
  { "criteria": { "cvssMin": 9.0 }, "action": "approve-to-ring", "ringId": "<id>" },
  { "criteria": { "classification": "definition" }, "action": "approve-catalog-only" },
  { "criteria": { "source": "thirdparty", "vendor": "Adobe" }, "action": "approve-to-ring", "ringId": "<id>" }
]
```

Healthcare-conservative tenant default: KEV → canary ring. Everything else → manual approval. Definitions auto-approved (no reboot, low risk).

## 8. Maintenance windows + deferral

New per-client schedule. Patches do NOT deploy outside a tenant's maintenance window unless the operator explicitly overrides per-deployment.

```prisma
model Fl_MaintenanceWindow {
  id            String   @id @default(cuid())
  tenantName    String
  /// Cron expression in tenant timezone. Multiple windows per tenant
  /// supported (one window per row).
  cron          String   // "0 2 * * 2,4"  (Tue + Thu 02:00)
  durationMin   Int      // 120 = 2-hour window
  timezone      String   @default("UTC")
  /// Optional per-host filter — RQL fragment. When set, this window
  /// applies only to matching hosts. Lets MSPs split clinical
  /// workstations from servers.
  rqlFilter     String?
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([tenantName, isActive])
}
```

Per-host snooze (operator-clicked from `/devices/[id]?tab=patches`) writes `Fl_PatchSnooze`:

```prisma
model Fl_PatchSnooze {
  id          String   @id @default(cuid())
  deviceId    String
  patchId     String
  snoozedUntil DateTime
  reason      String?
  snoozedBy   String
  /// Snooze counter — once we hit `Fl_Tenant.maxPatchSnoozes`, the
  /// next deploy attempt forces install regardless. Counters the
  /// "snooze forever" pattern that lets vulns linger.
  attemptCount Int     @default(1)
  createdAt   DateTime @default(now())
  @@unique([deviceId, patchId])
}
```

## 9. Reboot policy — Phase 3 reuse + hotpatch lane

Phase 3's `RebootPolicy` types (`never | defer-if-user-active | force | schedule-window`) carry through unchanged. Phase 4 adds two things:

1. **Hotpatch detection short-circuit.** When `Fl_Patch.isHotpatch=true`, the agent's `patches.deploy` handler skips the reboot path entirely, regardless of `requiresReboot`. The deployment completes with `result: "installed"` and `Fl_Device.pendingReboot` is NOT set. This is the clinical-workstation-friendly lane.
2. **Snooze-aware reboot countdown.** When `requiresReboot=true` and the host has logged-in user activity, the agent emits a desktop notification with countdown. UX matches Intune's snooze-but-with-cap pattern: 240-minute snooze, max 3 snoozes, then forced. The `Fl_PatchSnooze.attemptCount` enforces the cap server-side.

## 10. Pre-patch safety gates

Run on the agent before any install. All gates are operator-tunable per-deployment + per-tenant default in `Fl_Tenant.patchPreflightDefaultsJson`.

| Gate | Default | What the agent checks |
|---|---|---|
| `minDiskSpaceGb` | 15 (cumulative needs 10–20) | `Get-PSDrive C` `Free` ÷ 1GB |
| `maxRamPercent` | 90 | `Get-Counter "\Memory\% Committed Bytes In Use"` |
| `requireBackupWithinHours` | 24 | Reads vendor-specific log paths (Veeam / Datto BCDR / Acronis / SS Cloud / Windows Backup) and parses last-good-job timestamp + `errors=0` |
| `requireNoPendingReboot` | true | `HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager` `PendingFileRenameOperations` + Component-Based Servicing `RebootPending` key |
| `requireServiceHealth` | true | Agent + AV (`Get-MpComputerStatus.AntivirusEnabled`) + Time-sync (`w32tm /query /status` last sync < 24h) |
| `respectMaintenanceMode` | true | `Fl_Device.maintenanceMode` (Phase 3) |
| `customPreflightScriptId` | null | Optional Phase 2 script — if exit code != 0, gate fails |

Failed gate → `patches.complete` with `result: "preflight-failed"` and which gate. Deployment counters bump `preflightFailedCount` (new field on `Fl_Deployment`). Operator sees the gate name + threshold + actual on the per-target failure-row.

The custom preflight slot is the EHR-specific gate the field research highlighted (e.g. "no patch if charting session active") — operators wire it as a Phase 2 script and reference it here.

## 11. Rollback — layered, honest, observable

Strategies tried in order on `patches.uninstall`:

1. **`wusa /uninstall /kb:NNNN /quiet /norestart`** — works for some quality updates. `/quiet` is deprecated by MS but still functions on most current builds; we attempt it anyway, fall through on failure.
2. **DISM package removal** — `dism /online /remove-package /packagename:<derived>`. Works for combined cumulative packages where `wusa` is blocked.
3. **System Restore Point rollback** — set automatically pre-deploy when `Fl_Tenant.autoRestorePointBeforePatch=true` (default). Rolling back uses `Restore-Computer` with the patch-tagged restore point.
4. **VM snapshot rollback** — only attempted when `Fl_Device.hypervisorBinding` is set (Phase 4.5+: Hyper-V via WMI, ESXi via API, Proxmox via API). Falls back to "manual rollback required" with the snapshot id surfaced.

Each strategy reports `success | not-applicable | declined-by-os | failed`. The first `success` short-circuits. If all fail, deployment target enters `status="rollback-failed"` with the operator-actionable message: **"Rollback failed across all strategies. Restore from backup snapshot of `${Fl_Device.lastBackupSucceededAt}` or earlier (KB was first deployed `${Fl_PatchInstall.installedAt}`)."**

The "what was deployed when" timeline is THE thing that makes broken rollbacks survivable. Per-host patch history table on `/devices/[id]?tab=patches` shows install timestamps + which deployment-id installed it + the last verified backup before each install.

## 12. Multi-signal detection — the trust loop

Per-host per-patch state captures the cross-check:

```prisma
model Fl_PatchInstall {
  id                  String   @id @default(cuid())
  deviceId            String
  patchId             String
  patch               Fl_Patch @relation(fields: [patchId], references: [id])
  /// "installed" | "missing" | "failed" | "superseded" | "declined"
  /// | "preflight-failed" | "rollback-failed" | "detection-disagreement"
  state               String
  /// Per-method detection result. Null when method wasn't run.
  /// "detection-disagreement" state means at least two methods returned
  /// different answers — surfaced as an alert.
  wmiQfe              Boolean?
  dismPackages        Boolean?
  wuHistory           Boolean?
  /// When the agent last verified state.
  lastDetectedAt      DateTime
  /// The deployment that put this patch on the host (when known).
  installingDeploymentId String?
  installedAt         DateTime?
  failureReason       String?
  /// Free-text from the agent (DISM error, wusa exit code, etc).
  rawDetail           String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  @@unique([deviceId, patchId])
  @@index([state, lastDetectedAt])
}
```

The `detection-disagreement` state fires `Fl_Alert(kind="patch.detection.disagreement", severity="warn")` on detection. Operators love this — it's the "your dashboard is lying" early warning that NinjaOne / Datto / etc. don't surface.

## 13. UI surfaces

New screens + Phase 3 surface extensions:

### `/patches` — flips primary tab to **Vulnerable**

```
┌────────────────────────────────────────────────────────────────┐
│ Patches · Vulnerable                                           │
│ 12 active CVEs across 47 hosts (3 marked KEV by CISA)         │
│                                                                │
│ Tabs: Vulnerable · Queue · Posture · Catalog · History         │
│                                                                │
│ 🚨 CVE-2026-XXXX  KEV  CVSS 9.8  47 hosts  KB5036893           │
│    Closes: ms-KB5036893 (approved · canary ring)               │
│    [ Deploy now to 47 hosts → ]                                │
│                                                                │
│ ⚠ CVE-2026-YYYY  CVSS 8.1  12 hosts  KB5036900                 │
│    Closes: ms-KB5036900 (needs approval)                       │
│    [ Approve and deploy → ]                                    │
└────────────────────────────────────────────────────────────────┘
```

Drift is the secondary view (Phase 3-style: "approved KB at version X; 3 hosts on prior version"). The CVE-driven primary surface answers the only question that matters in a patch panic.

### `/patches/queue` — approval workflow

New patches needing operator decision. Each row: source · classification · CVE list with CVSS pills · KEV badge · supersedence chain · "Approve to ring ▾" / "Decline" / "Defer" actions. Bulk-action: "Approve all critical KEV to canary."

### `/patches/[id]` — per-patch detail

CVE list + per-CVE NVD link + KEV status + supersedence (this patch supersedes X, is superseded by Y) + deployment history (how many times deployed across rings, success/fail per ring) + per-host install state with the multi-signal detection breakdown.

### `/maintenance-windows` — per-client schedule editor

Cron + duration + timezone + optional RQL filter. Visual calendar overlay showing the next 7 days of scheduled windows across all tenants.

### `/devices/[id]?tab=patches` — extended

Per-host patch history with install timestamps + multi-signal detection state + per-patch snooze button (with the snooze-cap counter). "Pending reboot" chip when applicable. "Catch up on missing patches → ring" CTA.

### Cmd-K extensions

```
patch <kbId> [to <client|rql>]              → /deployments/new pre-filled
patch <cve> [to <client|rql>]               → resolves CVE → patch → form
rollback <kbId> on <hostname>               → /deployments/new (kind=patch, action=uninstall)
approve <patch>                             → POST approve + redirect to /patches/queue
defer <patch> for <duration>                → POST defer
snooze <kbId> on <hostname> for <duration>  → POST snooze
```

The CVE-as-target alias is critical — operators in a panic type `patch CVE-2026-XXXX` and get the right answer in one keystroke.

## 14. Schema additions (full delta vs Phase 3)

```prisma
model Fl_Patch              { … see §3 … }
model Fl_PatchAdvisory      { … see §4 … }
model Fl_PatchInstall       { … see §12 … }
model Fl_MaintenanceWindow  { … see §8 … }
model Fl_PatchSnooze        { … see §8 … }

model Fl_Tenant {
  // existing Phase 3 fields remain
  patchAutoApprovalJson         String?
  patchPreflightDefaultsJson    String?
  autoRestorePointBeforePatch   Boolean  @default(true)
  maxPatchSnoozes               Int      @default(3)
}

model Fl_Device {
  // existing Phase 3 fields remain
  lastPatchScanAt        DateTime?
  pendingPatchCount      Int        @default(0)
  pendingKevCount        Int        @default(0)
  /// Last good backup verified by pre-flight gate. Surfaced on the
  /// rollback failure message.
  lastBackupSucceededAt  DateTime?
  /// JSON: { kind: "hyperv"|"esxi"|"proxmox", host: "...", vmId: "..." }
  /// Null when host isn't a VM. Enables vm-snapshot rollback strategy.
  hypervisorBindingJson  String?
}

model Fl_Deployment {
  // existing Phase 3 fields remain
  packageId         String?  // was non-null; now nullable for patch deploys
  patchId           String?
  patch             Fl_Patch? @relation(fields: [patchId], references: [id])
  kind              String   @default("software")  // "software" | "patch"
  preflightFailedCount Int   @default(0)
  rollbackStrategiesAttemptedJson String?
}
```

## 15. Sequencing inside Phase 4

Bite-sized landings, each shippable as a container restart:

1. **Schema + protocol freeze.** Land the schema additions, protocol bumps, this design doc. Nothing executable yet.
2. **Catalog ingest — Microsoft only.** Cron pulls from PSWindowsUpdate-style upstream + KB metadata scrape. Populates `Fl_Patch` for the MS source. CVE/KEV ingest cron runs alongside.
3. **CVE/KEV surfacing — read-only.** `/patches?tab=vulnerable` ships against ingested data. Even before any deploy machinery, this is a sales-grade dashboard.
4. **Multi-signal detection.** Agent ships `patches.scan` + `patches.detect`. `Fl_PatchInstall` rows populate per host. Detection-disagreement alerts fire.
5. **Approval queue.** `/patches/queue` + per-tenant auto-approve rules.
6. **Deploy path.** Reuses Phase 3 rings + monitor. `/deployments/new?patchId=…` deep-links. Pre-flight gate runs first.
7. **Third-party catalog ingest.** Vendor-curated JSON feed. Adobe / Chrome / Zoom / Java / 7-Zip first.
8. **Maintenance windows + snooze.** `/maintenance-windows` editor; per-host snooze flow; snooze-cap enforcement.
9. **Rollback path.** `patches.uninstall` with layered strategies. "What was deployed when" timeline.
10. **Custom MSP patches.** Reuses Phase 3's mock-parse upload flow + signed-body Ed25519.
11. **Compliance reporting hooks.** Endpoint that emits per-host KB-by-KB matrix + SLA aging by CVSS band; consumed by Phase 5.
12. **HIPAA-mode soak.** Flip `hipaaMode=true` for one tenant; prove signed-body enforcement holds; prove audit-chain captures every patch op.

Each step is independently valuable. Step 3 (CVE dashboard read-only) is the sales-grade win even before deploys are possible.

## 16. Open questions

- **Microsoft Update Catalog access.** MS doesn't ship a clean public REST API. Options: (a) self-host WSUS as the upstream and consume its DB directly, (b) PSWindowsUpdate pulled per-host from agents and aggregated server-side, (c) HTML scrape of catalog.update.microsoft.com (fragile), (d) partner with a third-party feed. Lean toward (b) for v1 — agent is already privileged enough to enumerate; aggregation is straightforward — and (a) for tenants that have a WSUS server to point at.
- **Third-party catalog source.** Build vs partner with Patch My PC / Patch Connect Plus / Niagara. Lean build-first (Git-backed JSON we curate) so we can prove the model with 12 high-impact apps before paying a vendor. Schema mirrors PMP shape so swap is a one-function change.
- **VM hypervisor bindings.** Hyper-V is WMI; ESXi is REST + SOAP; Proxmox is REST. Different agent code per binding. Phase 4.5 — get Hyper-V working first since the clinical fleet skews Windows Server hosts.
- **Linux + macOS patches.** Out of v1 scope (see §17), but the catalog model is already source-agnostic — adding `source="apt" | "dnf" | "softwareupdate"` is mostly an ingest-cron addition.
- **Driver + firmware updates.** Rabbit hole. Defer — universal opt-in, no auto-approve.
- **CVSS 4.0 transition.** NVD is mid-migration; 3.1 stays the primary score; 4.0 captured when published but secondary.
- **Detection on cumulative-rollup hosts.** `Get-HotFix` misses cumulative rollups on Server 2012 R2 (documented). The multi-signal detection saves us; flag those tenants for `dismPackages`-as-primary.
- **Snooze UX on the host side.** Phase 4 ships server-side snooze enforcement. Desktop notification countdown UI on the agent side is Phase 4.5+ (Windows toast notifications via PowerShell-native or our own tray app).
- **Rollback-then-redeploy idempotency.** When ops rolls back a patch and it auto-redeploys via the ring, that's a loop. Needs an "after rollback, exclude this host from this patch's deployments for 30 days" mechanic. Punt to first observed real incident.

## 17. Non-goals (out of scope for Phase 4)

- **Linux package updates** (apt / dnf / yum / zypper). Defer to Phase 4.5 — Windows is 95% of clinical fleet.
- **macOS softwareupdate**. Defer — macOS auto-update is the norm; managed deferral is rarely the operator pain.
- **Driver updates.** Rabbit hole. Operator-uploadable as `source="custom"` if needed.
- **Firmware updates** (BIOS / Dell Command / HP SureClick). Vendor-specific, hardware-bricking risk. Defer.
- **Real-time CVE intelligence beyond NVD + CISA KEV.** Mandiant / CrowdStrike / etc. feeds are paid + opinionated. NVD + KEV cover 90% of operator decisions.
- **Patch testing in operator-provisioned VMs** (deploy to a sandbox first, observe, then promote to canary). Phase 5+.
- **AI-assisted patch impact prediction.** Tempting; no good training signal until we have years of deploy outcomes. Phase 6+.
- **Cross-tenant patch sharing** ("MSP-wide approval that propagates to 12 tenants at once"). Each deployment is tenant-scoped; cross-tenant ops are platform tier.
- **Rollback success guarantees.** Honesty matters: rollback is best-effort scripting + restore-from-backup. We make the backup decision answerable in 5 seconds; we don't pretend `wusa /uninstall` is reliable.

These are valuable, just not Phase 4 valuable. The line is drawn at "what makes a tech's daily patch flow great on a Windows-heavy clinical MSP fleet."

## 18. Audit + compliance reporting

Audit rows per HIPAA-READY §2:

- `patch.advisory.ingest` — ingest cron writes one per new advisory.
- `patch.approval.{approve,decline,defer}` — operator decisions. Justification required for HIPAA tenants on decline.
- `patch.deployment.create` — same as `software.deployment.create` but with `kind=patch`.
- `patch.deployment.target-complete` — per-target. Includes consensus from multi-signal detection.
- `patch.uninstall.{attempt,success,fail}` — per-strategy results during rollback.
- `patch.snooze.{set,enforce-cap}` — operator snoozes; system enforces the cap.
- `patch.detection.disagreement` — alert-worthy event; logged with per-method results.

Compliance report endpoint (consumed by Phase 5):

```
GET /api/reports/patch-compliance?tenant=<name>&asOf=<iso>
→ {
    asOf: <iso>,
    tenant: <name>,
    fleetSize: <n>,
    posture: { compliant: <n>, nonCompliant: <n>, exceptions: <n> },
    slaAging: {
      critical: { withinSla: <n>, overdue: <n>, meanDays: <n> },
      high:     { ... },
      medium:   { ... }
    },
    perHost: [
      { hostname, kbMatrix: { "KB5036893": "installed-2026-04-15", "KB5036900": "missing", ... }, lastScanAt }
    ],
    exceptions: [
      { patchId, justification, deferredBy, deferredUntil }
    ]
  }
```

The historical question ("what was patch state on 2026-03-15 at 10:00?") gets a clean answer because `Fl_PatchInstall` is append-on-state-change and `lastDetectedAt` timestamps are preserved. Phase 5 renders this to a PDF.

## 19. Voice check

Same voice as Phase 2 + Phase 3. Spec IS the contract; deviations require updating this doc first. If implementation contradicts §3 or §11, edit the doc, get sign-off, then write the code.

The honest acknowledgments in §11 (rollback is 30% reliable) and §16 (no clean MS Update Catalog API) are deliberate. Patch management is the part of RMM where vendors over-promise the most; the design is meant to ship what actually works and tell the truth about what doesn't.
