# FleetHub → RMM Parity Backlog

**Status:** 2026-06-17 — Lead-architect synthesis of an A-team audit (117 verified, de-duplicated findings) into one prioritized backlog. Goal: blend the best of **Tactical RMM + Syncro + Action1/Atera** at true Win/Mac/Linux parity, with first-class **integration bridges** to TicketHub (PSA), OpsHub (ops), and the customer portal. PSA/billing core itself stays in TicketHub.

---

## Executive summary

FleetHub is a structurally strong RMM whose **data model, security posture, and automation engine already rival or beat the commercial field** — but a surprising amount of headline functionality is *built on both ends (agent + server) yet stranded behind a missing wire or a missing button*. The fastest path to feeling like a real competitor is not net-new invention; it is **finishing what is already 80% built** and closing a small set of genuinely-absent table-stakes primitives (policy inheritance, real check types, scheduled scripts, a real patch catalog).

**Where FleetHub already leads / is at parity:**
- **Security & compliance depth** — HMAC envelopes, mTLS-intended transport, append-only hash-chained audit, 4-eyes approval gate, KEK/crypto vault + WebAuthn + MFA, signed scripts/packages. This is *ahead* of Syncro/Atera out of the box (caveats below — several guarantees are app-discipline, not enforced).
- **Deployment ring engine** — canary→broad→full with abort-failure-rate + soak auto-promote is genuinely strong; just not yet bridged into patch validation.
- **Runbook reactive-remediation engine** — dry-run-first, circuit-breaker (maxFiresPerHour / maxConsecutiveFailures) are real and enforced. Only templates + custom-field triggers are missing.
- **Per-client risk rollup** — `computeRiskScore` weighting KEV/patch-lag/alerts on the MSP page is a real risk dashboard; only per-*device* surfacing is missing.
- **KEV breach-aware vuln signal** and a multi-channel alert/escalation/on-call spine.

**The big gaps (parity-blocking):**
1. **No policy/folder inheritance** — the single biggest scaling gap. Every monitor/patch-rule/script is configured per-device. This is the spine of every competing RMM.
2. **Monitoring is CPU/RAM/disk only** — no service/ping/HTTP/event-log/script-output checks, no agent-local checks, no live (sub-15-min) telemetry. You cannot alert on "Spooler stopped" or "website down" today.
3. **No scheduled/recurring scripts** — core automation primitive entirely absent.
4. **Patch catalog is a 24-KB hand-curated mock** — no real MSRC/NVD ingest, flat 7.0 CVSS, no third-party (winget/choco) patching, no patch automation policy, macOS gets no Apple `softwareupdate`.
5. **Stranded remote-access features** — interactive terminal, process/service inspector, file transfer, AV control, reboot: agent verbs ship, **but no operator UI and (for several) no dispatch route**. The terminal byte-stream bridge is the highest-leverage dead feature in the codebase.
6. **Integration bridges are read-only** — no time-tracking → TicketHub, no device→asset sync, no auto-ticket dedup, no bidirectional PSA↔RMM state, no portal write-back.
7. **Security enforcement gaps that read as P0** — VIEWER can run code fleet-wide; agent-ingest trusts the envelope (cross-tenant injection); agent revocation flag is checked nowhere; bulk fan-out has no approval gate; bootstrap installer has no checksum verification despite claiming it does. Several HIPAA-READY promises are app-discipline only, not enforced.

**Net:** the audit confirms the product is closer to parity than its surface suggests. ~30% of the backlog is "connect two existing ends," ~40% is genuinely-absent table-stakes, ~30% is hardening/polish.

---

## Quick Wins (high leverage, low effort — do these first)

| ID | Item | Effort | Why it's a quick win |
|---|---|---|---|
| QW-1 | Wire **interactive terminal** byte-stream bridge + Terminal button (RA-1) | S–M | Full backend on both ends ships; only the SSE/WSS relay + one ActionBar button missing. Most visible dead feature. |
| QW-2 | Fix **bulk "Run script"** dead deep-link (SA-3) | S | `/scripts` ignores `hosts=`; selecting N devices silently drops context. Route exists, needs wiring. |
| QW-3 | **VIEWER can run code** → add `requireRole('TECH')` to script-run/patch-deploy/deployments (SEC-2) | S | Read-only must be read-only by construction. `lib/authz.ts` exists. |
| QW-4 | **Agent revocation** enforced at ingest + dispatch (SEC-4) | S–M | Kill-switch flag checked nowhere; revoked agents still report + take commands. |
| QW-5 | **Bootstrap installer checksum** verify (sha256 + Authenticode) (SEC-7) | S | `curl | mv` to root with no verification; comment falsely claims it verifies. |
| QW-6 | **Reboot/Shutdown** verb + button on device detail (RA-4) | S–M | Most-used RMM action, absent on the most-used page. |
| QW-7 | **Save selection as group/view** bulk action (UX-bulk) | S | Zero new backend — groups + resolveGroupTargets + getDeviceViews exist. |
| QW-8 | **Constant-time cron bearer** compare + **split agent secret** (SEC-9) | S | One-line `timingSafeEqual` swap; HMAC path already constant-time. |
| QW-9 | **AV_ENGINES enum** expand (clamav/xprotect/s1/crowdstrike) so detected engines surface (AGT-AV-1) | S | Agent already detects them; server discards. Cheap cross-platform posture win. |
| QW-10 | **Idle-session 15-min TTL** (set `session.maxAge`) (SEC-10) | S | HIPAA-locked timeout; today effective TTL is NextAuth 30-day default. |
| QW-11 | **Strip Phase-N dev scaffolding** from dashboard/reports (UX-1) | S | "Phase 0 — the fleet populates once the agent ships" reads as unfinished. |
| QW-12 | **File-transfer UI** on device detail (RA-5) | S–M | Model + route + agent verb + tenant toggle all ship; only the button is missing. |
| QW-13 | **Asset/warranty write path** in device PATCH + inputs (INV-3) | S | PATCH only accepts friendlyName; unblocks warranty report. |
| QW-14 | Consolidate **3 TicketHub URL env vars** → 2 (INT-config) | S | Half-configured `.env` silently routes bridges to wrong place. |

---

## Epic A — Monitoring & Alerting

The most-used RMM check family (availability/service/event-log) does not exist, and all evaluation is server-cron-polled at 15-min granularity. This is the most parity-incomplete area after patching.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| MON-1 | **New check types**: winservice/service-state, TCP/ping/HTTP availability, Windows event-log / syslog / journald, arbitrary script-output (exit-code/stdout-pattern). New `METRIC_RESOLVERS` + predicate shapes. | **P0** | L | Win/Mac/Linux | net-new (merges #1,#20) | Single most-used Tactical/Atera family. Service+script-output reuse `fleet.services.list`/`script.run`; HTTP/ping can run server-side initially. |
| MON-2 | **Agent-local check runner** — server pushes check def + interval; agent evaluates between heartbeats and fires `alert.fire` on state-change only. | **P0** | L | Win/Mac/Linux | net-new (merges #52, ties #44) | The Tactical core model. `alert.fire` referenced in `session_io.go:297` but no local evaluator. Fast detection + coverage during brief disconnects. |
| MON-3 | **Real-time perf telemetry** — dedicated 30–60s perf ticker (`perf.sample` notify) streaming CPU/mem/disk-IO/net-IO/loadavg/top-N → `Fl_PerformanceSample` + live device graph. Keep heartbeat cheap. | **P0** | M | Win/Mac/Linux | net-new (#44) | Model exists server-side. 15-min aggregate means spikes invisible; no "live device" graph possible today. |
| MON-4 | **Log collection** — Win `Get-WinEvent`, Linux `journalctl -o json` + `/var/log` tail, macOS `log show`. `logs.query` verb + monitor source. | **P1** | M | Win/Mac/Linux | net-new (#45) | Drives event-ID / log-keyword conditions. Pairs with MON-1 event-log family. |
| MON-5 | **Custom monitor expressions** (`Fl_Monitor.expressionJson`) — composite logic (CPU>90 AND mem>80 sustained) + evaluator branch + author UI. | **P1** | M | Win/Mac/Linux | **Phase 13 designed, never built** (#83) | Schema column + evaluator + UI all absent. Differentiator vs canned thresholds. |
| MON-6 | **Alert Templates** — single object bundling threshold + notify + remediation + periodic re-alert + resolved-notify, referenceable by checks/policies. | **P2** | M | Win/Mac/Linux | composition gap (#10) | All primitives exist (`AlertRoute` channels/escalation/dedup, `Runbook` on-match). Gap is the bundling object + UX, feeds POL-1. |
| MON-7 | **Check-level "run task on failure"** — add `onFailScriptId` (+dry-run-first) to the monitor, OR auto-generate the runbook match from `emitKind`. | **P2** | S | Win/Mac/Linux | ergonomic (#11) | Fail→remediate path *works* (monitor fires → runbook `matchJson`), but wiring is fragile/hand-mirrored. Declare remediation once at check-create. |
| MON-8 | **Live device-list status** — 30–60s poll (mirror sidebar approvals poll) or SSE online channel; "last refreshed / refresh now" affordance. | P2 | M | Win/Mac/Linux | polish (#68) | Online/offline dots frozen at page-load; baseline RMM expectation. |
| MON-9 | **TopBar alert bell live poll** — give the bell the same 30s poll as the approvals badge; unify into one notification-poll hook. | P3 | S | Win/Mac/Linux | polish (#73) | New critical alert doesn't bump the bell until navigation. |

---

## Epic B — Patch & Vulnerability Management

Today's catalog is a 24-KB hand-seeded mock with flat 7.0 CVSS. Patch automation, third-party patching, real metadata, and macOS OS patching are all missing. This is the area an Action1/Atera prospect judges first.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| PAT-1 | **Real MS patch catalog ingest** — MSRC CVRF API (CVE→KB + classification + supersedence) and/or aggregate agent `PSWindowsUpdate` into a self-built catalog; populate `cveJson` on agent-discovered patches. Replace `patch-mock.ts`. | **P0** | L | Windows | mock today (#31) | Foundation. Without it, Vulnerable tab only covers 24 seeded KBs; agent-discovered patches get no CVE. Enables PAT-2, PAT-7. |
| PAT-2 | **NVD/CVSS/EPSS enrichment** — real CVSS v3.1/v4 base+vector on `cve-refresh` cron + FIRST EPSS; sort Vulnerable list by (KEV, EPSS, CVSS) not the flat 7.0 placeholder. | **P0** | M | Win/Mac/Linux | net-new (#34) | All KEV CVEs share synthetic 7.0 floor → can't prioritize a 9.8 RCE. `msp.riskScore` inherits flat data. Builds on PAT-1. |
| PAT-3 | **Patch automation policy** — per-severity disposition (auto/manual/ignore) + Patch-Tuesday+N schedule + reboot/maintenance-window binding + target ring; cron auto-creates deployments. | **P0** | L | Win/Mac/Linux | net-new (merges #14,#21,#36) | Severity grid is how MSPs auto-approve cumulatives while holding drivers manual. Manual approve-then-deploy per wave does not scale. Lives inside POL-1; reuses `DeployRing`. |
| PAT-4 | **Windows third-party patching** — winget (`winget upgrade --include-unknown`) + choco (`choco outdated -r`) enumeration in `patches_windows.go`, `source='thirdparty'`, wire deploy. | **P0** | M | Windows | net-new (#32) | Action1/Atera flagship (Chrome/Acrobat/Java). Today third-party only via version-pinned `Fl_Package`, not vuln-driven. |
| PAT-5 | **macOS `softwareupdate`** — `--list`/`--install` enumeration+apply (recommended vs all, reboot handling) so Apple security updates are inventoried+deployable. | **P0** | M | macOS | net-new (#48) | Cross-platform parity failure: brew-only leaves the macOS OS unpatched/uncounted. |
| PAT-6 | **"Update if present" / auto-keep third-party apps current** — agent reports installed apps, server matches winget/choco/brew, auto-creates update deployments for outdated. Turn Drift read-only → one-click/auto. | **P1** | M | Win/Mac/Linux | net-new (#22) | Top Syncro/Action1 differentiator. Depends on POL-1. |
| PAT-7 | **Patch supersedence** — populate `supersedesIdsJson` from ingest, set `state='superseded'`, collapse superseded rows in Vulnerable/Catalog, block deploy of superseded KBs. | **P1** | M | Windows | **dead schema stub** (#39) | Field + 'superseded' state + read-only UI exist; **nothing writes them**, no list collapse, no deploy guard. Depends on PAT-1. |
| PAT-8 | **macOS patch OS-label fix** — map source→os (`brew→macos`, `apt/dnf→linux`, `ms→windows`) or carry agent platform on the envelope. | **P1** | S | macOS | bug (#33) | Homebrew patches stored as `os='linux'` → every Mac patch misclassified, breaking per-OS filtering/reporting silently. |
| PAT-9 | **Pre-deploy patch-test ring** — patch policy designates a test ring that auto-deploys new patches, observes failure over a soak, surfaces "tested clean, ready to approve broadly." Bridge `rings.ts` into patch-approval. | **P2** | M | Win/Mac/Linux | net-new (#40) | The ring engine is a strength but unused for patch validation. Pairs with PAT-3. |
| PAT-10 | **Maintenance-window-bound reboots** — resolve a device's actual `Fl_MaintenanceWindow` server-side (helpers exist in `maintenance-windows.ts`); add "deploy during next window" on the deploy form. | **P2** | M | Win/Mac/Linux | partial (#41) | Today only a coarse `respectMaintenanceMode` boolean is passed; server never resolves the per-device window. |

---

## Epic C — Scripting & Automation

The runbook engine is strong; the gaps are **scheduled scripts** (entirely absent), **policy bundling**, and script-library UX. `Fl_ScriptRun.initiatedBy` already documents "null for cron/scheduled" — but nothing creates such rows.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| SA-1 | **Scheduled / recurring scripts (Automated Tasks)** — `ScriptSchedule` model (cron/interval + target group/tag + maintenance-window aware) + `script-schedule-fire` cron enqueuing `Fl_ScriptRun`. "Schedule" alongside "Run now." | **P0** | M | Win/Mac/Linux | net-new (merges #2,#19) | Core RMM hygiene. Mirror `report-schedules`/`runbook-watcher`. Only manual button-press today. |
| SA-2 | **Standalone reboot/shutdown/logoff verb** — `power.reboot/shutdown/logoff` (optional delay+message), 4-eyes-gated, cross-platform. | **P0** | S | Win/Mac/Linux | net-new (#49, #62) | Restart only happens as a patch side-effect today; no reboot verb or route exists. Unblocks RA-4 + bulk reboot. |
| SA-3 | **Fix bulk "Run script" dead deep-link** — make `/scripts` read `hosts=` and fan out, OR in-place script-picker modal fanning out per host. | **P1** | M | Win/Mac/Linux | broken (#63) | Selecting N devices silently drops host context; BulkBar comment falsely claims fan-out exists. Route exists. |
| SA-4 | **Curated cross-platform script library + community import** — seed library, starter runbook templates (disk-full→cleanup, service-down→restart), import-from-URL. `isCurated`/`category`/`tagsJson` already exist. | **P1** | M | Win/Mac/Linux | net-new (merges #24,#15,#26-templates) | Blank-canvas onboarding vs Tactical community-scripts / Syncro ComStore is a major parity gap. |
| SA-5 | **Script parameters + run-as + secret masking** — declared params (name/type/default/required) → run-time form; OS-variant grouping (one logical "Restart Spooler"); **masked secret vars** (env is plaintext in audit today); **run-as selector** (SYSTEM vs logged-in user / root vs user). | **P1** | M | Win/Mac/Linux | partial (merges #15,#59) | Library + env passthrough already exist; missing = param schema, variant linkage, masking, RunAsUser. Scripts run only as the agent service context today. |
| SA-6 | **Config/registry write verb** — `config.set` (Win registry, macOS `defaults`/plist, Linux key=value/sysctl), type handling, 4-eyes-gated. | **P2** | M | Win/Mac/Linux | net-new (#56) | Config-drift remediation needs a write path; today every change is a full signed script run. |
| SA-7 | **Runbook starter templates + custom-field condition triggers** — ship templates; let `matchJson` reference custom fields. | **P2** | S | Win/Mac/Linux | partial (#26) | NOTE: dry-run-first + circuit-breaker are **already enforced** (audit corrected the false claim). Only templates + custom-field triggers remain. Depends on INV-1. |

---

## Epic D — Remote Access (the "stranded backend" epic)

The highest density of built-but-unreachable features. Agent verbs and (sometimes) routes ship; the operator surface is missing.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| RA-1 | **Interactive terminal — wire the byte-stream bridge** — SSE/WSS relay between `XtermDrawer` and agent `shell.{open,input,output,resize,close}`; add Terminal button to device ActionBar / Shell tab. | **P0** | S–M | Win/Mac/Linux | **stranded** (merges #4,#60,#75) | Single highest-leverage dead feature: xterm UI, SSE plumbing, `shell/open` route, `Fl_ShellSession`, all agent verbs ship — but no operator can reach a terminal. Only the relay + entry point missing. |
| RA-2 | **PTY terminal** — `creack/pty` (unix) + ConPTY (Windows), register `shell.resize`, propagate xterm cols/rows. | **P1** | M | Win/Mac/Linux | net-new (#46) | Current shell is `TERM=dumb` non-PTY → vim/top/color/line-edit broken. Terminal is cosmetic without this. Pairs with RA-1. |
| RA-3 | **Process & service inspector UI + dispatch route** — `app/api/admin/devices/[id]/processes` (list/kill) + `/services` (list/start/stop/restart); Processes + Services tabs. | **P1** | M | Win/Mac/Linux | **stranded** (merges #5,#61,#76) | All agent verbs ship cross-platform (`processes_{linux,darwin,windows}.go` all exist) but **no dispatch route + no UI**. macOS list-only for service control. Add `fleet.processes.kill` (PID+tree, 4-eyes) (#54). |
| RA-4 | **Reboot/Shutdown button** on device detail (consumes SA-2 verb) + confirm/schedule via existing `ConfirmModal` + `submitWithApproval`. | **P0** | S | Win/Mac/Linux | net-new (#62) | ActionBar comment admits Reboot/Quick-Job were removed as "placebos." |
| RA-5 | **File-transfer UI** — Files panel on device detail (push-to-path / pull-from-host), gated by existing tenant toggle + admin route; render `Fl_FileTransfer` history. | **P1** | S–M | Win/Mac/Linux | **stranded** (merges #71,#78) | Model + route + `fleet.file` verb + per-tenant enable/justification/max-size toggle all ship; only the button missing. |
| RA-6 | **AV/EDR control UI + dispatch route** — AV action buttons (scan/cancel/update/quarantine/release) capability-gated on Defender advertisement; AV-action dispatch route (only ingest route exists today). | **P1** | M | Windows | **Phase 13 designed, stranded** (merges #64,#77) | Agent exposes `fleet.av.{scan,...}` but operator can only view. **Windows/Defender-only** — capability gating already hides the tab on Mac/Linux (no 502-on-click), so scope is Windows parity, not cross-platform. |
| RA-7 | **Wake-on-LAN** — `wol.send` verb so an online agent broadcasts a magic packet to a sibling's MAC; one-click "Wake" using a same-client online relay. | **P2** | S | Win/Mac/Linux | net-new (#50) | NIC MACs already collected. Wake offline endpoints before patch windows. |
| RA-8 | **Screenshot-on-demand** — `screenshot.capture` → one-off PNG (Win GDI/DXGI, macOS `screencapture`, Linux scrot/grim). | P2 | M | Win/Mac/Linux | net-new (#51) | Lower urgency — RustDesk covers full remote. Screen-record nice-to-have. |
| RA-9 | **Content-recording shell sessions** — `Fl_ShellSession.recordingS3Url` + capture `shell.output` to asciicast-v2 on close + playback view. | P2 | L | Win/Mac/Linux | **Phase 13 designed, never built** (#84) | SOC2/HIPAA privileged-session-playback differentiator. Depends on RA-1 stream bridge + object storage. |

---

## Epic E — Cross-platform Agent

The explicit Win/Mac/Linux-equality mandate has concrete violations, plus the operationally-critical self-update gap.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| AGT-1 | **Agent self-update** — poll `latest-version`, verify sha256/signature, write `<bin>.new`, restart via service manager (Win service/systemd/launchd), report version; default-on except HIPAA mode. "Agents out of date" widget. | **P0** | M | Win/Mac/Linux | **server infra built, no agent consumer** (merges #37,#53) | `agent.update` advertised + `agent-manifest.json` exists, but the Go agent never upgrades. Manual MSI redeploy per fix is untenable at scale. |
| AGT-2 | **Package-manager advertisement + bootstrap** — agent advertises available winget/choco/brew/apt/dnf via `capabilities.update`; UI gates install actions; optionally bootstrap choco/brew when missing. | **P1** | M | Win/Mac/Linux | net-new (#16) | `software.install` drives managers none of which are guaranteed present → opaque failures. Ties to SD-1. |
| AGT-3 | **macOS/Linux service control** — macOS `launchctl` (bootstrap/bootout/kickstart, gui/`<uid>` vs system) + Linux SysV/OpenRC fallback; advertise `fleet.services` there. | **P1** | M | Mac/Linux | partial (#58) | Control works only on Win + systemd-Linux; macOS + non-systemd Linux are list-only. |
| AGT-AV-1 | **Surface detected non-Defender AV** — add clamav/xprotect/sentinelone/crowdstrike to `AV_ENGINES` enum so detected engines stop being discarded server-side. | **P1** | S | Mac/Linux/Win | partial (#9) | Agent already detects ClamAV/XProtect but reports `engine='none'` because the enum has no slot. AV column always empty on Mac/Linux. Cheap. |
| AGT-AV-2 | **Linux ClamAV scan/update/quarantine verbs** + posture ingest. | **P2** | M | Linux | net-new (merges #9,#29,#89) | Closes the most-glaring half of the AV-mutate gap. macOS documented detection-only (no scriptable XProtect trigger). Capability gating already prevents dead buttons. Pairs with RA-6. |
| AGT-AV-3 | **EDR control adapters** — CrowdStrike (`falconctl`/API), SentinelOne (`sentinelctl`), Defender-for-Endpoint (`mdatp`): trigger-scan + quarantine/release. Advertise `fleet.av` per-product. | P2 | L | Win/Mac/Linux | net-new (#47) | Mixed fleets run Falcon/S1/Sophos; detect-but-can't-act. Needs vendor CLIs/APIs. |
| AGT-4 | **Custom-package artifact parsing** — replace `mockParseArtifact` with `msiinfo` (.msi ProductCode/UpgradeCode), `pkgutil`/`installer` (.pkg), `dpkg-deb` (.deb); capture real silent flags. | **P1** | M | Win/Mac/Linux | mock (#86) | Fabricated ProductCodes make "is it installed?"/compliance checks silently lie. Needs msitools/dpkg/pkgutil in build/runtime container. |
| AGT-5 | **Full software inventory + usage metering** — ship the full installed list (name/version/publisher/install-date), not the 6-item sample; last-run metering (Win prefetch / process sampling) for unused-license reclamation. | **P1** | M | Win/Mac/Linux | truncated (#57) | 6-item sample makes software page + license reconciliation impossible. |
| AGT-6 | **Agent-driven network discovery** — `discovery.scan` so a designated on-net agent does ARP/ping sweep (+SNMP get) of its subnet, reports unmanaged hosts → network-devices page + "unmanaged device" alerts. | **P1** | L | Win/Mac/Linux | net-new (merges #55,#42) | Server-only probing can't reach private subnets behind NAT. Feeds the coverage-gap risk view (REP-2). |

---

## Epic F — Policy, Inventory & Asset Management

Policy inheritance is **the** scaling primitive and the largest single net-new investment. Custom fields, Site tier, and saved-search builder cluster here.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| POL-1 | **Automation Policy / folder model** — bundle checks + automated tasks + patch policy + alert template, assignable at tenant/group/site with inheritance. `admin/policies` today is only a tenant security-flag matrix. | **P0** | XL | Win/Mac/Linux | net-new (merges #6,#17) | THE scaling spine (Tactical Policies / Syncro Policies / NinjaOne / Atera Profiles). Onboarding a client without it = hand-creating every monitor. Bundles MON-1, SA-1, PAT-3, MON-6. |
| INV-1 | **Custom fields** — definition table (scope client/site/device; text/number/date/checkbox/select) in add/edit forms; collector-task type piping script last-line into a field; promote `tagsJson` to first-class filterable. | **P1** | M–L | Win/Mac/Linux | net-new (merges #7,#18) | Tactical/Syncro staple (warranty refs, owners, app data). Feeds saved searches, runbook predicates (SA-7), dynamic groups. |
| INV-2 | **Site / location tier** — Client → Site → Device, usable in scoping/reporting/policy targeting. | **P1** | L | Win/Mac/Linux | net-new (#8) | Multi-location clients (e.g. a 4-clinic HIPAA group) can't be scoped per site. **TicketHub already has `TH_Site`** — align for cross-app joins. Strengthens POL-1. |
| INV-3 | **Asset/warranty write path** — extend device PATCH (+ inputs) to accept `assetTag`/`purchasedAt`/`purchasePriceCents`/`warrantyExpiresAt`. | **P1** | S | Win/Mac/Linux | **Phase 13 designed, never built** (#79) | PATCH only accepts `friendlyName`. Unblocks REP-1 warranty report. Quick win. |
| INV-4 | **Warranty auto-lookup + Installed-Apps workbench** — manufacturer lookup by serial (Dell/HP/Lenovo); per-device Installed Apps view with inline update/uninstall wired to deployments. | **P2** | M | Win/Mac/Linux | partial (merges #27,#3) | Warranty is read-only (only `mock-fleet.ts` hard-codes "Dell"). Turns the 9-tab asset page into a workbench. Pairs with SD-1. |
| INV-5 | **Visual saved-search / RQL condition-builder** — compose conditions across inventory/posture/custom-fields, preview matches, save as shared view reusable as monitor/runbook/policy target. | **P2** | M | Win/Mac/Linux | partial (merges #28, #18) | `Fl_DeviceGroup.rql` + `Fl_DeviceView` exist but only power group membership; no builder UX. Depends on INV-1. |

---

## Epic G — Software Deployment

Backend + verbs ship; the friction is the package+deployment ceremony for one-off installs.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| SD-1 | **Ad-hoc per-device/per-group install** — browse winget/choco/brew catalog, dispatch `software.install` directly; installed-software list with inline Uninstall — no `Fl_Package`+deployment ceremony. | **P1** | M | Win/Mac/Linux | backend-ready (#3) | Action1/Atera/Syncro = two clicks. Needs new route + device-page UI. Ties to AGT-2 (manager advertisement), INV-4. |

---

## Epic H — Integration Bridges (TicketHub / OpsHub / Portal / DocHub)

First-class suite goal. Today bridges are **read + count + alert→ticket only**. The time-tracking and bidirectional-state bridges are what make the suite cohere.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| INT-1 | **Time-tracking → TicketHub** — capture RemoteSession + ScriptRun elapsed time, operator tags billable + ticket #, POST a draft time-card via signed BFF; `pushedToPsaAt` idempotency. Needs TH `/api/bff/fleet/time-entry`. | **P1** | M | Win/Mac/Linux | **Phase 13 designed, never built** (merges #12,#25,#81,#90) | The RMM↔PSA bridge that monetizes the suite. `lib/bff-th-client.ts` exists but "Phase 1 unused." Billing core stays in TH; capture belongs in FH. |
| INT-2 | **Device → TicketHub asset sync** — upsert `Fl_Device` identity (serial/OS/model/warranty) into a TH asset table; set/confirm `th_tickets.fleetDeviceId` bidirectionally; "create/attach TH asset" on device page. | **P1** | M | Win/Mac/Linux | net-new (#91) | Today the device↔ticket link is hand-created TH-side; PSA has no authoritative endpoint inventory. Needs TH asset table + write BFF. |
| INT-3 | **Auto-ticket dedup + reconciliation** — before `createAutoTicket`, find the most-recent non-failed `ticket`-channel `AlertDispatch` with `externalId` for (clientName, deviceId, kind); pass `existingTicketId` so TH appends a comment; round-trip `created:false` → "linked to #X." | **P1** | M | Win/Mac/Linux | net-new (#92) | Flapping alerts / multi-route matches spawn duplicate tickets. Needs TH create-ticket to accept an `existingTicketId` hint. |
| INT-4 | **KEV/failed-patch → auto-ticket** — runbook/cron rule "new KEV affecting ≥1 host" or "patch failed on N hosts" → create/append TH ticket with affected-device list; surface patch-compliance % on portal. | **P1** | M | Win/Mac/Linux | net-new (#43) | The strongest trigger sources never auto-create a PSA ticket. Leverages PAT-1/PAT-2 KEV data. |
| INT-5 | **Bidirectional PSA↔RMM state (TH→FH back-channel)** — inbound BFF (`FL_BFF_SECRET`, reverse) for TH to POST ticket lifecycle keyed on `externalId`/`fleetDeviceId`; auto-resolve originating alert on ticket close; show "tech dispatched / on-site" on device page. | **P1** | M | Win/Mac/Linux | net-new (#102) | RMM + PSA state drift apart; operator works a stale alert whose ticket is already closed. Pairs with the DocHub iPad aux-display pattern. |
| INT-6 | **Client identity reconciliation + rename propagation** — cron/report flagging `Fl_Tenant` names with no matching `TH_Client`; guarded rename tool updating `Fl_Tenant.name` + all `Fl_Device.clientName` + FKs in one transaction. Long-term: stable client id, not name, as join key. | **P1** | M | Win/Mac/Linux | net-new (merges #96,#99) | All cross-schema joins key on name-equality. A TH_Client rename silently breaks every join to zero rows — billing sync, linked tickets, portal all go dark. Resolve clientName to TH canonical casing at auto-ticket send-time. |
| INT-7 | **PSA sync visibility + seat-overage** — per-tenant reconciliation read-out (last run, count written, contract item matched y/n); distinct "skipped: no contract item" reason; read TH contract seat ceiling, badge/alert on overage. | **P2** | M | Win/Mac/Linux | net-new (merges #94,#95) | `psaSyncEnabled` with no tagged contract item writes nothing + reports success silently → billing under-counts. Over-deployment past seats is a silent quantity bump. |
| INT-8 | **Portal write-back** — HMAC + `portalEnabled`-gated BFF routes for customer "approve this patch window" + "request remote session for device X," landing as `Fl_ActionApproval` or TH ticket. | **P2** | M | Win/Mac/Linux | net-new (#97) | Customers can't approve windows or request help from the portal; falls back to phone/email. Windows + approvals are staff-only today. |
| INT-9 | **URL Actions** — operator-defined templated links with `{{variable}}` substitution from device/client fields, as device-page buttons (ScreenConnect/AnyDesk/vendor portals/**DocHub deep-links**). | **P2** | S | Win/Mac/Linux | net-new (#13) | The lightweight integration escape hatch + the pragmatic DocHub deep-link bridge. Pure web, no agent work. Use the cross-app URL roster. |
| INT-10 | **Config hygiene** — consolidate `TICKETHUB_BASE_URL`/`_BFF_URL`/`_PUBLIC_URL` → `TICKETHUB_BASE_URL` (server) + `TICKETHUB_PUBLIC_URL` (browser); document in Credentials.md. | P2 | S | Win/Mac/Linux | bug (#93) | Half-configured `.env` silently routes one bridge to prod default, throws on another. Quick win. |
| INT-11 | **OpsHub console decision** — decide + document: (a) show OpsHub ops alerts on MSP page, (b) push FH critical alerts to OpsHub incident feed, or (c) explicitly "transport only." | P3 | S | Win/Mac/Linux | undocumented (#98) | Intent ambiguous today. Lowest cost: just document the boundary. |
| INT-12 | **Outbound bridge-failure health + retry** — integration-health panel (TH reachable?, last psa-sync result, 24h failed `ticket`-dispatch count) + bounded retry/backoff for transient auto-ticket failures. | P2 | M | Win/Mac/Linux | net-new (#100) | A 30s TH restart permanently drops the auto-ticket with no retry; operator only learns by reading dispatch rows. |
| INT-13 | **ConnectWise PSA-out adapter** — create/update tickets from `Fl_Alert` behind an outbound integration config. | P3 | L | Win/Mac/Linux | **Phase 13 designed, never built** (#82) | For shops not on TicketHub. Lower priority — own TH bridge is primary. See non-goals. |

---

## Epic I — Security, RBAC & Scale (hardening)

Several of these read as **P0** despite being "hardening" — they are exploitable today and undercut the compliance story FleetHub markets. Many HIPAA-READY promises are currently app-discipline, not enforced.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| SEC-1 | **agent-ingest envelope trust → AgentRegistration check** — look up `Fl_AgentRegistration` by `env.agentId`, reject if missing/revoked, assert `registration.tenantName === device.clientName` before any write. | **P0** | M | Win/Mac/Linux | exploitable (#106) | Gateway HMAC authenticates the gateway, not the agent. Any valid gateway-signed body can create/overwrite devices for **any tenant**. Hard tenant isolation is the core multi-tenant guarantee. Shares fix surface with SEC-4. |
| SEC-2 | **VIEWER can run code → `requireRole('TECH')`** on script-run, patch-deploy, deployments. | **P0** | M | Win/Mac/Linux | exploitable (#104) | VIEWER enforced only by UI hiding. Any authenticated staff can POST and execute fleet-wide. (shell/file-transfer/backup already use `requireAdmin`.) Quick win. |
| SEC-3 | **Bulk fan-out approval gate** — add `script.run`/`patch.deploy` to the approval-action union; wire `shouldRequireApproval('bulk.dispatch', {deviceCount})` before the per-device loop; consume peer approval over `bulkApprovalThreshold`; always require for HIPAA tenants. | **P0** | M | Win/Mac/Linux | exploitable (#103) | One operator can fan a script/patch across a whole tenant with no peer review or fat-finger threshold. `lib/approval-gate.ts` exists. |
| SEC-4 | **Enforce agent revocation** — check `isRevoked` at (1) agent-ingest, (2) every `dispatchToAgent`, (3) push gateway session-kill on revoke. | **P0** | S–M | Win/Mac/Linux | dead flag (#114) | `isRevoked` appears nowhere in app code; revoked agents keep reporting + take commands while their WSS session lives. Kill-switch does nothing. Quick win. |
| SEC-5 | **WSS gateway: mTLS + per-agent proof keys + HA** — terminate mTLS pinning PCC2K CA; per-agent proof keys (mirror `agentSecretHash`); externalize session + replay-nonce to Redis for N-replica HA. | **P1** | L | Win/Mac/Linux | dev shortcuts (#108) | Ships plain `ws://`, one shared `GATEWAY_DEV_TOKEN`, in-process nonce state (single-instance, no HA, no shared replay dedupe). Trust + scale foundation. |
| SEC-6 | **Per-client staff RBAC scope** (`Fl_StaffClientScope`) — allow/deny per (staffUser, clientName); resolve allowed-clients in `getSessionContext`; enforce on every tenant-scoped query + dispatch. ADMIN = all unless denied. | **P1** | L | Win/Mac/Linux | **HIPAA-locked, never built** (#107) | HIPAA-READY §3 locks per-client scoping (exclude a junior tech from a healthcare client). Any in-role staff acts on every tenant today. Touches every tenant-scoped route. |
| SEC-7 | **Bootstrap installer checksum/signature** — `bootstrap.sh`: `sha256sum -c` vs manifest before `mv` (fail closed); `bootstrap.ps1`: `Get-FileHash` + `Get-AuthenticodeSignature`; publish/verify the Ed25519/EV signature. Fix the misleading `[binary]` route comment. | **P1** | M | Win/Mac/Linux | **false claim** (#111) | `curl | mv` to `/usr/local/bin` as root with no check → MITM/compromised `/install` = root RCE on every enrolling endpoint. Comment falsely claims it verifies. Quick win. |
| SEC-8 | **HTTP rate-limiting** — per-IP (agent-ingest, inbound/[token], install/bootstrap), per-user (command APIs), per-tenant (portal BFF); 429 + Retry-After; shared store for multi-instance. | **P1** | M | Win/Mac/Linux | net-new (merges #109,#88) | Unauthenticated surfaces have no throttle → brute-force, enroll-token guessing, exhaustion. Inbound route comment literally reserves 429 unimplemented. Ties to SEC-5 Redis. |
| SEC-9 | **Portal BFF tenant binding** — bind request to a FH-verifiable tenant (signed assertion or `Fl_PortalUser`/personId map keyed by `portalUserId`); ignore client-supplied `clientName`; reject mismatch + audit `portal.cross_tenant.attempt`. | **P1** | M | Win/Mac/Linux | cross-tenant risk (#112) | BFF HMAC authenticates the portal app, not the user's tenant; `portalUserId` logged but never validated to belong to `clientName`. Any portalEnabled tenant's fleet readable. |
| SEC-10 | **Server-side script-signing enforcement** — when tenant `hipaaMode` or `script.requiresSignature`, recompute `SHA-256(body)==bodySha256` + verify `bodyEd25519Sig` against tenant compliance public key; reject `state='rejected'`. Implement the `signerKid` lookup. | **P1** | M | Win/Mac/Linux | **trusted to agent** (#105) | HIPAA-READY §6 promises signed-script-only, but server dispatches whatever is stored (`signerKid:''`) and relies on the agent to verify. |
| SEC-11 | **Idle-session 15-min TTL** — set `session.maxAge` (default 900s, per-tenant) + `updateAge` sliding refresh + client-side activity sign-out. | **P1** | S | Win/Mac/Linux | **HIPAA-locked, not enforced** (#117) | Effective TTL is NextAuth 30-day default; an unattended workstation stays authed for weeks. Quick win. |
| SEC-12 | **Portal report-download re-validation** — re-validate `report.tenantName == authorized clientName` inside the stream route (token carries clientName binding); audit on the stream route, not just the mint step. | **P1** | S | Win/Mac/Linux | single-checkpoint (#101) | Cross-client authorization rests on one mint-time check; a portal mis-bind streams another client's report. |
| SEC-13 | **file.transfer approval gate + signed-URL validation** — add shell.open-style approval gate; mint/validate `pushSourceUrl` server-side (FH-signed short-TTL only) instead of trusting the operator string. | **P1** | M | Win/Mac/Linux | partial (#113) | file-transfer requires ADMIN+justification but has NO approval path and forwards caller-supplied `pushSourceUrl` verbatim → operator can point the agent at any URL to fetch-and-write. |
| SEC-14 | **Constant-time cron compare + split agent secret** — swap `lib/with-cron-auth.ts` bearer compare to `timingSafeEqual`; split `FLEETHUB_AGENT_SECRET` into inbound-ingest vs outbound-dispatch, rotate on schedule. | **P2** | S | Win/Mac/Linux | partial (#115) | HMAC path already constant-time; only the cron bearer is plain `!==`. One shared secret serves both directions → leak in one grants the other. Quick win. |
| SEC-15 | **Append-only audit assertion** — startup/health check (or `/api/audit/verify-grants`) querying `has_table_privilege` for app-role UPDATE/DELETE on `fl_audit_log`; fail loud; make `hipaa-audit-revoke.sql` part of the deploy/migrate pipeline. | **P2** | S | Win/Mac/Linux | out-of-band (#116) | Tamper-evidence depends on a manual `REVOKE` script; nothing asserts the app role lacks UPDATE/DELETE. A fresh DB silently leaves the audit log mutable. |
| SCALE-1 | **Shard the audit hash-chain** — per-tenant advisory lock + tail pointer, OR move high-volume agent-telemetry audit rows to a separate non-chained table (reserve the chain for human/privileged actions); index the tail. | **P2** | M | Win/Mac/Linux | bottleneck (#110) | Every privileged action AND every `inventory.report`/heartbeat/`alert.fire` serializes through one `pg_advisory_xact_lock(8675309)` + tail `findFirst` → write-throughput ceiling + ingest SPOF. Code comment flags it. |
| SCALE-2 | **Gate mock test/seed routes** — `_simulate`/`_seed` behind `NODE_ENV!=='production'` (or delete); remove stale "mock-driven in v1" copy. | P2 | S | Win/Mac/Linux | hygiene (#87) | Live test routes fabricate deploy/script-run state — integrity/abuse footgun. Quick win, pairs with UX-1. |

---

## Epic J — UX & Mobile Polish

The web UI *is* the field/on-call experience (no native app). Mobile nav is the conspicuous gap; the rest is professional-console polish.

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| UX-1 | **Strip Phase-N dev scaffolding** — replace the Build-status rail with fleet health / recent deployments / quick-actions; remove "Phase N" copy from dashboard subtitle, StatCard hints, reports header. | **P2** | S | Win/Mac/Linux | scaffolding (#65) | "Phase 0 — the fleet populates once the agent ships" reads as unfinished/internal. Quick win, pairs with SCALE-2. |
| UX-2 | **Mobile navigation** — below ~768px render sidebar as off-canvas drawer behind a TopBar hamburger; auto-collapse; overlay-dismiss on route change; persist manual collapse to localStorage. | **P2** | M | Win/Mac/Linux | **Phase 13 designed, partial** (merges #23,#66) | Sidebar eats ~55% of a phone viewport with no hamburger. Action-row/kv-grid mobile CSS already assumes phone use; MSP dashboard already reflows — nav is the missing piece. |
| UX-3 | **Bulk fleet verbs** — bulk Reboot (needs SA-2), bulk Patch-scan, Add-to-group/tag, **Save selection as group/view** (zero new backend). | **P2** | M | Win/Mac/Linux | partial (merges #30,#69) | `DeviceTable` already has multi-select + BulkBar + Run-script + Maintenance ON/OFF with approval gating. Only the missing verbs remain. Save-as-group is the cheapest high-value piece (quick win). |
| UX-4 | **Global toast/notify system** — one provider mounted in AppShell; route fire-and-forget outcomes through it; keep InlineAlert for in-form validation. | P3 | M | Win/Mac/Linux | net-new (#72) | Feedback (script dispatched, maintenance set, reboot queued) surfaces inconsistently per page. |
| UX-5 | **Wire orphaned Saved Views on /alerts (+/devices)** — wire the existing `SavedViewBar` (page='alerts') into the alerts page via the already-built `/api/account/saved-views`; reconcile the two device saved-view mechanisms. | **P2** | S | Win/Mac/Linux | **Phase 12 built, orphaned** (#85) | The generic SavedViewBar + API (built for both pages) is wired into nothing; /devices' working views come from a separate path. Cheap. |
| UX-6 | **Generalize columns/saved layouts** — extend `ColumnsMenu` + `UserDevicePreference` to patches/software/alerts (at least show/hide). | P3 | M | Win/Mac/Linux | asymmetry (#70) | Only /devices has a persisted column picker; dense tables elsewhere are fixed-column. |
| UX-7 | **Per-route loading + error boundaries** — segment `loading.tsx` skeletons for heavy pages (devices/[id], patches, msp, reports) + group-level `error.tsx` with retry. `SkeletonBar`/`fl-shimmer` exist. | P3 | M | Win/Mac/Linux | net-new (#74) | One generic root skeleton; a failed query throws to the framework default. |
| UX-8 | **Consolidate bulk-action bars** — migrate `DeviceTable` + `AlertsTable` onto canonical `components/ui/BulkBar`, delete the two local copies. | P3 | S | Win/Mac/Linux | drift (#67) | Canonical `ui/BulkBar` imported by **zero** files; both tables still hand-roll bars (consolidation at 0%). Cosmetic. |

---

## Epic K — Reporting

| ID | Item | Priority | Effort | Platforms | State | Notes |
|---|---|---|---|---|---|---|
| REP-1 | **Warranty-expiring / asset-lifecycle report kind** — builder in `lib/reports/` + `SUPPORTED_KINDS` entry + report-schedules option. | **P2** | M | Win/Mac/Linux | **Phase 13 designed, never built** (#80) | Standard QBR/renewal driver. Blocked on INV-3 (no warranty data to report until the write path exists). |
| REP-2 | **Per-device risk surfacing** — per-device composite risk score, risk/KEV column on the **devices list**, "most exposed devices" ranked view, risk-over-time trend. | **P2** | M | Win/Mac/Linux | partial (#35) | Per-*client* rollup already strong (`computeRiskScore`, MSP page). Devices-list page has no risk/kev/cvss column. Improved by PAT-2. |
| REP-3 | **Inline interactive reports** — live HTML table you view+filter in the browser + instant client-side CSV/PDF export, beside the existing async signed-evidence file pipeline. | P3 | M | Win/Mac/Linux | partial (#38) | On-demand report path already exists; gap is async-file-render vs inline-interactive. |

---

## Roadmap accounting: "designed but never built" vs net-new

**Phase 12 (Operations expansion) — incomplete items surfaced:**
- Saved views on /alerts + /devices → **built but orphaned** (UX-5).
- (Network/SNMP, maintenance windows, KEK rotation UI, shell/file/backup agent verbs, xterm.js, evaluator throttling, on-call DST shipped as backend — but xterm/shell/file/AV are **stranded with no operator wire**: RA-1, RA-3, RA-5, RA-6.)

**Phase 13 (project-close MVP) — designed, NOT shipped (confirmed in code):**
- Content-recording shell (`recordingS3Url` + asciicast) → RA-9.
- Process/service inspector → RA-3 (agent done, no route/UI).
- Mutable AV/EDR (Defender) → RA-6 (verbs ship, no route/UI).
- Time-tracking → TicketHub → INT-1.
- Custom monitor expressions (`expressionJson`) → MON-5.
- Asset/warranty input UI → INV-3; warranty report → REP-1.
- Mobile-responsive MSP → UX-2 (partial).
- Basic ConnectWise PSA-out → INT-13.

**Locked HIPAA-READY constraints that were never enforced (compliance debt, treat as P0/P1 security):**
- Per-client staff scope (§3) → SEC-6.
- 15-min idle timeout (§3) → SEC-11.
- Signed-script-only enforcement (§6) → SEC-10.
- Signed installer (§4) → SEC-7.
- Append-only audit as a DB constraint (§2) → SEC-15.

Everything else is **net-new parity work** (policy inheritance, real check types, scheduled scripts, real patch catalog/third-party/macOS, agent self-update, integration bridges).

---

## Re-examining the declared NON-GOALS against the parity goal

| Non-goal (closed at Phase 13) | Recommendation | Rationale |
|---|---|---|
| **Third-party patch catalog** | **REOPEN — P0.** | Action1/Atera's flagship is third-party (Chrome/Acrobat/Java) patching. PAT-1/PAT-4 are parity-blocking, not optional. This is the most important reopen. |
| **PWA / native mobile** | **PARTIAL REOPEN — responsive web, P2 (UX-2). Defer true native.** | The web console *is* the field experience. Responsive nav is cheap and necessary. A native PWA wrapper can wait — but make the web usable on a phone now. |
| **More PSA adapters (Halo/Autotask/ConnectWise)** | **REOPEN ConnectWise only — P3 (INT-13).** Keep Halo/Autotask closed. | ConnectWise was already designed and serves the largest non-TicketHub MSP base. The suite's own TicketHub bridge (INT-1..7) is the priority; broaden only after it's solid. |
| **AI alert correlation** | **Keep closed for now; revisit after MON-1/MON-2.** | Correlation needs a rich, real check/event stream first. Once agent-local checks + log collection exist, a lightweight de-dup/root-cause grouping becomes high-value — but it is not table-stakes parity. |
| **CMDB dependency graph** | **Keep closed; partial reopen via INT-2 asset sync + INV-2 Site tier.** | A full dependency graph is over-scope, but a flat device→asset inventory in the PSA (INT-2) and a Site tier (INV-2) deliver 80% of the CMDB value competitors actually ship. |
| **HSM / KMS** | **Keep closed.** | The crypto bundle (KEK rotation, vault, WebAuthn) already exceeds Syncro/Atera. HSM is enterprise-tier polish, not parity. Revisit only for a specific compliance contract. |
| **Multi-region / white-label federation** | **Keep closed.** | Scale/SPOF work (SCALE-1, SEC-5 HA) matters first; multi-region and federation are post-parity. |

---

## Recommended build sequence

The fastest route to *feeling* like a real Tactical/Syncro/Action1 competitor — front-load stranded-feature wakeups and the exploitable security gaps (cheap, high-trust), then the scaling spine, then patching depth, then bridges.

**Wave 0 — Trust & Quick Wins (1–2 weeks, mostly S):**
SEC-2 (VIEWER lockout), SEC-4 (revocation), SEC-1 (envelope trust), SEC-3 (bulk approval), SEC-7 (installer checksum), SEC-11 (idle TTL), SEC-14 (cron const-time) — close the exploitable holes. In parallel: RA-1 (terminal bridge), SA-3 (bulk run-script fix), RA-4+SA-2 (reboot), RA-5 (file-transfer UI), UX-1 (strip scaffolding), AGT-AV-1 (AV enum), INT-10/INV-3/UX-5 quick wins. *This single wave makes the product feel finished and trustworthy.*

**Wave 1 — Stranded backend + cross-platform agent:**
RA-3 (process/service inspector), RA-6 (AV control UI), AGT-1 (agent self-update — operationally essential), RA-2 (PTY), AGT-3 (mac/Linux service control), AGT-5 (full software inventory), SD-1 (ad-hoc install). *Now every shipped agent capability is reachable.*

**Wave 2 — Monitoring parity:**
MON-1 (check types), MON-2 (agent-local checks), MON-3 (live perf), MON-4 (log collection), MON-7 (check-level remediation). *Now you can alert on "Spooler stopped" and "website down" — the #1 demoed competitor feature.*

**Wave 3 — The scaling spine:**
POL-1 (automation policy/folder inheritance) + INV-1 (custom fields) + INV-2 (Site tier) + SA-1 (scheduled scripts) + MON-6 (alert templates). *Now onboarding a client is one policy assignment, not N hand-built monitors.*

**Wave 4 — Patching depth:**
PAT-1 (real catalog) → PAT-2 (CVSS/EPSS) → PAT-3 (automation policy) → PAT-4/PAT-5 (third-party + macOS) → PAT-6/PAT-7/PAT-9. *Now patching matches Action1/Atera, the area prospects judge first.*

**Wave 5 — Integration bridges (the suite payoff):**
INT-1 (time-tracking → TicketHub), INT-2 (asset sync), INT-3/INT-4 (auto-ticket dedup + KEV trigger), INT-5 (bidirectional state), INT-6 (identity reconciliation), INT-9 (URL/DocHub deep-links). *Now FleetHub monetizes through TicketHub and the suite coheres.*

**Wave 6 — Scale, compliance debt & polish:**
SEC-5 (mTLS+HA), SEC-6 (per-client scope), SEC-8 (rate-limit), SEC-10 (script-sig), SEC-15/SCALE-1 (audit), then REP-1/REP-2, UX-2/UX-3/UX-4, RA-9 (session recording). *Hardens for fleet scale + closes the HIPAA compliance debt the product already markets.*

---

*Source: A-team audit, 117 verified findings (de-duplicated of false positives), synthesized 2026-06-17. Item IDs above map to the original finding numbers in the Notes column. Several audit "absences" were corrected to "partial/stranded/built-but-orphaned" — those corrections are reflected in the State column and are the cheapest wins in the backlog.*
