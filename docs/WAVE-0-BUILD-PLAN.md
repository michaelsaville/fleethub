# FleetHub Wave 0 — Concrete Build Plan

**Status:** 2026-06-17 — scoping of Wave 0 ("Trust & Quick Wins") from RMM-PARITY-BACKLOG.md into a buildable plan, grounded in the actual code. Goal of the wave: *make the product feel finished and trustworthy* — close the exploitable security holes and wake the stranded backend, mostly small edits, no DB migrations.

Deploy model (confirmed): local image build, **no CI/registry**. `docker-compose.yml` uses `build: .`, container `fleethub-app`, published `:3011`. Deploy = `cd ~/fleethub && docker compose up -d --build app`. Same manual model as TicketHub.

DB impact (confirmed): **no Prisma migration required for Wave 0.** Every column/field needed already exists (`Fl_AgentRegistration.isRevoked`; `Fl_Device.assetTag/purchasedAt/purchasePriceCents/warrantyExpiresAt`); `AV_ENGINES` is a JS `Set` in `lib/posture.ts`; session timeout + `bulkApprovalThreshold` are config.

---

## Workstreams

### WS-A — Security lockdowns (server-only, no agent change)

| ID | Change | Files | Approach | Risk |
|---|---|---|---|---|
| SEC-2 | VIEWER can't run code | `lib/authz.ts` (+ `app/api/scripts/[id]/run`, `script-runs/*`, `patches/[id]/deploy`, `deployments/*`) | Add `requireRole('TECH')` helper next to existing `requireSession`/`requireAdmin`; call at top of each command route. | Low — UI already hides these from VIEWER; gate just enforces by construction. |
| SEC-4 | Enforce agent revocation | `lib/agent-ingest.ts`, `lib/dispatch*.ts`, gateway session | Check `Fl_AgentRegistration.isRevoked` (1) at ingest before any write, (2) in every `dispatchToAgent`, (3) emit gateway session-kill on revoke. Flag is currently read nowhere. | Low — adds a deny path; no schema change. |
| SEC-1 | Agent-ingest envelope trust → registration check | `lib/agent-ingest.ts` | After HMAC, look up `Fl_AgentRegistration` by `env.agentId`; reject if missing/revoked; assert `registration.tenantName === device.clientName` before write. | **Medium — could reject live agents that lack a registration row.** Ship in **log-only mode first** (log mismatch, allow), confirm 100% coverage in `/audit`, then flip to enforce next deploy. |
| SEC-3 | Bulk fan-out approval gate | `app/api/scripts/[id]/run`, `patches/[id]/deploy` | `ApprovalAction` union + `shouldRequireApproval('bulk.dispatch',{deviceCount})` already exist; call before the per-device loop, consume peer approval over `bulkApprovalThreshold`, always require for HIPAA tenants. | Low — wiring existing gate. |
| SEC-11 | Idle-session 15-min TTL | `lib/auth-options.ts` | Add `session.maxAge` (default 900s via `SESSION_MAX_AGE` env) + `updateAge` sliding refresh. | **Medium behavioral — shortens all sessions; idle staff re-auth sooner.** Make the value env-driven so it's tunable without redeploy. |
| SEC-14 | Const-time cron compare | `lib/with-cron-auth.ts` | Swap `auth !== \`Bearer ${secret}\`` for `crypto.timingSafeEqual`. (Secret *split* deferred — see below.) | Low. |
| SEC-7 | Bootstrap installer checksum | `app/app/install/bootstrap.sh/route.ts`, `bootstrap.ps1/route.ts`, fix `[binary]/route.ts` comment | Add `sha256sum -c` vs `agent-manifest.json` before `mv` (fail closed); PS1 `Get-FileHash`. **Authenticode/Ed25519 signature verify is BLOCKED on the EV cert (YubiKey signing not yet provisioned) — sha256 ships now, signature is a follow-up.** | Low. |

### WS-B — Stranded-feature wakeups (server + UI, no agent change)

| ID | Change | Files | Approach |
|---|---|---|---|
| RA-1 | Wire interactive terminal | `components/XtermDrawer.tsx`, `app/api/admin/devices/[id]/shell/open`, new SSE relay route | XtermDrawer + `shell/open` route + `Fl_ShellSession` + agent `shell.*` verbs all ship. Build the SSE/relay between agent `shell.output` and the drawer; add a **Terminal** button to the device ActionBar / Shell tab. Highest-leverage dead feature. |
| SA-3 | Fix bulk "Run script" deep-link | `components/DeviceTable.tsx`, `app/(protected)/scripts/page.tsx` | `/scripts` ignores `hosts=`; selecting N devices drops context. Make `/scripts` read `hosts=` and fan out (or in-place script-picker modal). Route already exists. |
| RA-5 | File-transfer UI | device detail page, existing `admin/devices/[id]/file-transfer` route | Model + route + `fleet.file` verb + per-tenant toggle all ship; add a Files panel (push/pull) + render `Fl_FileTransfer` history. Button is the only gap. |

### WS-C — Agent-dependent (Go repo + endpoint redeploy)

| ID | Change | Files | Approach | Dependency |
|---|---|---|---|---|
| SA-2 / RA-4 | Reboot/Shutdown verb + button | `~/pcc2k-agent/cmd/*` (new `power.reboot/shutdown/logoff`), new server dispatch route, device ActionBar button | 4-eyes-gated, cross-platform Go verb; server route; confirm/schedule via existing `ConfirmModal`+`submitWithApproval`. | **New agent binary must reach endpoints. Self-update (AGT-1) is Wave 1, so distribution is manual today.** Server+UI+verb can be built now; reboot goes live only as agents carry the new binary. |

### WS-D — Polish & data quick wins (server + UI)

| ID | Change | Files | Approach |
|---|---|---|---|
| UX-1 | Strip Phase-N dev scaffolding | dashboard page, reports header, StatCard hints | Replace Build-status rail with fleet-health / recent-deployments / quick-actions; remove "Phase N" copy. |
| AGT-AV-1 | Surface non-Defender AV | `lib/posture.ts` (`AV_ENGINES` Set) | Add `clamav/xprotect/sentinelone/crowdstrike` to the Set so agent-detected engines stop being discarded. One-line. |
| INV-3 | Asset/warranty write path | `app/api/devices/[id]/route.ts` (+ device edit inputs) | PATCH currently only accepts `friendlyName`; accept `assetTag/purchasedAt/purchasePriceCents/warrantyExpiresAt` (columns exist). Unblocks REP-1 warranty report later. |
| INT-10 | Env hygiene | `.env`, `lib/*` reading `TICKETHUB_*` | Code references `TICKETHUB_BASE_URL` + `_BFF_URL` + `_PUBLIC_URL`; only `BASE_URL` is set. Consolidate to `TICKETHUB_BASE_URL` (server) + `TICKETHUB_PUBLIC_URL` (browser); add the latter to `.env`; document in Credentials.md. |
| UX-5 | Wire orphaned Saved Views | `components/SavedViewBar`, `app/(protected)/alerts/page.tsx`, `app/api/account/saved-views` | The generic SavedViewBar + API ship but are wired into nothing; wire into `/alerts`. Reconcile the two device saved-view paths later. |

---

## Sequencing (within Wave 0)

1. **WS-A security** first (SEC-2, SEC-4, SEC-3, SEC-14, SEC-7-sha256 — all low-risk; SEC-1 log-only; SEC-11 env-gated). One commit per logical fix.
2. **WS-D quick wins** (AGT-AV-1, INV-3, INT-10, UX-1, UX-5) — independent, cheap, parallel-safe.
3. **WS-B stranded wakeups** (RA-1 terminal, SA-3 bulk, RA-5 files) — more UI surface; verify each in an authed browser session.
4. **WS-C reboot** — only if authorized to touch the agent repo; otherwise defers to Wave 1.

Deploy cadence: build + restart `fleethub-app` after each workstream, smoke-test, before moving on.

---

## Permission / authorization gate (ask BEFORE building)

The build touches live auth behavior, the server `.env`, the agent ingest path, and (for reboot) the separate agent repo. Before writing any code, confirm:

1. **Deploy posture** — local build only / build+restart+verify / full commit+push+deploy.
2. **Server `.env` edits** — may I edit the live `.env` (INT-10 `TICKETHUB_PUBLIC_URL`, SEC-11 `SESSION_MAX_AGE`) with a backup? Secret-split (SEC-14) deferred unless explicitly approved (needs agent coordination).
3. **Reboot / agent repo (WS-C)** — include now (build verb + server + UI, live as agents redeploy) or defer to Wave 1 with self-update.
4. **Behavioral-change items** — SEC-11 (shorter sessions) and SEC-1 (registration-gated ingest): proceed with SEC-1 in log-only mode first, enforce immediately, or hold both.

No DB migration is required for Wave 0, so no schema-change authorization is needed; if that changes mid-build, stop and ask.
