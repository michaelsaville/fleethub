# FleetHub Phase 11 — Security-Heavy Crypto Bundle (Design)

**Status:** Draft, 2026-05-18. Not yet implemented. Phase 11 is the
**security-heavy crypto bundle** — the phase that lands the
credential vault, WebAuthn, 4-eyes approval, and the shared
`Fl_CryptoKey` rotation primitive all together so key management is
amortized across one phase instead of three. The architect's framing
on the Phase 10 design pulled all of these out of Phase 10
explicitly; this is where they come home.

**Scope of this doc:** five workstreams. Like prior phases, each is
independently shippable. Like prior phase docs, the spec IS the
contract.

The five workstreams:

- **A — Crypto + vault foundation.** A single `Fl_CryptoKey` table
  covering every server-side secret (vault-KEK, WebAuthn-RP keypair,
  4-eyes approval-signing, Phase 7's alert-ack signing — one
  rotation procedure, one audit verb). `lib/credential-vault.ts`
  AES-256-GCM via per-tenant DEK wrapped by the env-derived root.
  `Fl_Credential` + `Fl_CredentialDisclosureLog`. Audit-redaction
  allowlist in `withAudit` so disclose rows never leak ciphertext
  through `detailJson`. Prove the primitive end-to-end on Slack
  webhook secrets (currently plaintext in `Fl_AlertRoute.channelsJson`).
  `/credentials/[id]` page in read-mode only — the **disclose**
  endpoint ships in WS-B once step-up auth exists.
- **B — 4-eyes approval workflow.** `Fl_ActionApproval` state
  machine (`pending` / `approved` / `denied` / `expired`).
  `/approvals` inbox sibling of `/alerts`. `ApprovalGate` HOC
  wrapping the verbs the audit flagged as blast-radius: bulk
  dispatch above an operator-configurable threshold, `shell.open`
  on production-tagged devices, `credential.disclose`,
  `credential.update`, destructive edits to `Fl_AlertRoute` /
  `Fl_OncallSchedule`. Signed approval URL using
  `Fl_CryptoKey purpose='approval-signing'`. Per-tenant peer-approval
  threshold + per-device-tag scope on the Policies subtab (WS-D).
  Audit `backup.trigger` instead of gating it (gating reversible
  operations breeds approval fatigue and kills the muscle).
- **C — WebAuthn + MFA hardening.** `Fl_WebAuthnCred` model + enroll
  / verify routes built on `@simplewebauthn/server`. Step-up auth
  verb the disclose + approve paths require. Rate-limit + 5-strike
  lockout on `mfa-verify` (today: no throttle, line-rate brute-force
  surface). Field-based routing on `mfa-verify` (today: 6-char
  length decides token vs recovery-code — recovery prefixes
  misroute and silent-fail). Recovery-code countability + a
  regenerate route gated on current TOTP. `/account/security`
  self-service MFA enrollment (today: admin-only at
  `/setup/staff/[id]`). Fix `lib/auth-options.ts` JWT-refresh bug:
  `mfaRequired` is only re-read on initial sign-in today, so
  flipping `Fl_Tenant.mfaRequired=true` does not gate live sessions
  — lands EARLY in WS-C so the rest of WS-C and WS-B can be
  honestly tested.
- **D — Policies subtab + cross-tenant sweep.** `TenantSettingsTab`
  converted from 7 stacked Groups in one 300-line scroll to a
  left-rail nested-tab nav (Security / Remote / Portal / Backup /
  Shell / File / Integrations / Policies). Policies subtab houses
  the Phase 11 toggles (MFA-required, peer-approval thresholds,
  per-device-tag scopes, vault-access rules) alongside ~13 missing
  Phase 9/10 toggles still operator-as-Prisma. New `/admin/policies`
  cross-tenant sweep page: a tenant-row × policy-column matrix that
  lets an admin flip MFA-required (or any policy) across N tenants
  in one form (operator opens 12 client pages today).
- **E — UI primitives III + tech-debt close + Phase-11 prep.**
  `MaskedField` primitive (sensitive-input with toggleable reveal +
  copy-to-clipboard hook for the disclosure-log writer; used by
  WS-A vault UI + recovery-code reveal + SMTP/webhook fields).
  `NotificationBadge` primitive (sidebar approval-inbox count).
  `StatCard size="sm"` variant (closes the 4-Tile-clone debt Phase
  10 deferred). `Table.tsx` w/ TH+TD primitives, migrate top 5 list
  pages (audit, devices/[id], monitors, deployments, patches).
  `Button size="xs"` (closes the NotesCard / MfaChallengeForm
  hand-rolled icon-button debt). `Chip` `interactive` + `active`
  modes (audit-page QuickRangePresets hand-rolls these today).
  `NotesCard` SSR/CSR FOUC fix (mono-pre-wrap → sanitized-HTML
  flicker on hydrate). `lib/markdown.ts` hardening:
  `rel="noopener noreferrer"` autoinject + explicit
  `ALLOWED_URI_REGEXP` (today: `data:` URIs in href slip past
  allowlist). `middleware.ts` matcher tightening (`_seed`,
  `well-known`, `favicon` prefix-match gaps). `Fl_AuditLog.reviewStatus`
  enum + "High-risk unreviewed" quick-range pill on `/audit`.
  Device-notes `_count.notes` chip on `/devices` table rows. Delete
  the Phase-9 cron-secret fallback (`FLEETHUB_AGENT_SECRET` shim;
  14 cron routes; one-release grace expires). New vitest files for
  `lib/mfa-cookie.ts`, `app/api/auth/mfa-verify/route.ts`,
  `lib/markdown.ts` XSS vectors, and the three Phase-10 agent-ingest
  envelope handlers.

**Cross-references:**

- [`PHASE-10-DESIGN.md`](PHASE-10-DESIGN.md) §13 — Phase 11 was
  named as the home for credential vault, WebAuthn, 4-eyes
  approval, network device monitoring (SNMP), recurring tenant
  maintenance windows, process/service inspector, content-recording
  shell sessions, and mutable AV/EDR management. This design ships
  the first three plus the unifying `Fl_CryptoKey` primitive. The
  remaining five are pulled forward to Phase 12 — see §13 for the
  rationale. The architect's "Trojan horse" pushback on network
  device monitoring (full new noun + probe pipeline + crons + page
  = full phase) drove that cut.
- [`PHASE-9-DESIGN.md`](PHASE-9-DESIGN.md) §11 → [`PHASE-10-DESIGN.md`](PHASE-10-DESIGN.md) §11
  — auth-contract changes ship last. Phase 11 inverts: the crypto
  primitive (WS-A) ships FIRST, so every later WS uses it from
  day one. Auth-contract changes inside WS-C (rate-limit, lockout,
  field-routing, JWT-refresh) ship EARLY in WS-C, not last in the
  phase.
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) — Phase 11 introduces
  zero new ingest envelope kinds. Wire format unchanged.
- [`HIPAA-READY.md`](HIPAA-READY.md) — WS-A audit-redaction
  allowlist + WS-B 4-eyes audit trail close the two biggest
  HIPAA gaps Phase 10 left open (secret-leak via audit chain,
  bulk-destructive without peer review).

---

## 1. What Phase 11 ships

Concretely, by the end of each workstream:

**Workstream A — Crypto + vault foundation:**

- New `lib/crypto-key.ts` (server-only) — single source of truth
  for every server-side secret. Wraps Node `crypto` for AES-256-GCM
  + HMAC + Ed25519 keypair generation. Reads root from
  `FLEETHUB_CRYPTO_ROOT_KEY` env (32-byte base64). Exposes:
  - `getActiveKey(purpose: KeyPurpose)` → returns active key for
    purpose; loads from `Fl_CryptoKey` then caches in-process.
  - `rotateKey(purpose, actorEmail)` → generates new key, marks
    prior as `retiredAt`, emits `crypto.key.rotated` audit row.
    Disclose-on-rotate is purpose-specific (symmetric: rewrap;
    asymmetric: keep both readers).
  - `signApprovalToken(payload)` / `verifyApprovalToken(token)`
    — HMAC over canonical JSON, used by WS-B.
- New `lib/credential-vault.ts` (server-only):
  - `seal({ tenantName, kind, label, plaintext })` → encrypts
    plaintext using tenant DEK wrapped by active `vault-kek`,
    writes `Fl_Credential` row, returns id.
  - `unseal({ credentialId, actorEmail, justification, ip,
    userAgent })` → reads ciphertext, decrypts via tenant DEK,
    writes `Fl_CredentialDisclosureLog` row, returns plaintext.
    Caller MUST have a valid step-up token from WS-C.
  - `rotateCredential(id, newPlaintext, actorEmail)` → seals new
    plaintext, marks old `replacedAt`, keeps row for forensics.
- New Prisma models (additive, no destructive DDL):
  - `Fl_CryptoKey { id, purpose enum, algorithm enum, keyMaterial
    Bytes (encrypted at rest by root key for symmetric/HMAC;
    public-key-only for asymmetric public side; wrapped private
    for asymmetric private side), createdAt, retiredAt?, version
    int }`. Purposes: `vault-kek`, `webauthn-rp`,
    `approval-signing`, `ack-signing` (Phase 7 migration), with
    room for future purposes via enum extension.
  - `Fl_Credential { id, tenantName, kind enum (admin-pw / api-key
    / wifi-psk / snmp-v3 / smtp-password / webhook-secret / other),
    label, ciphertext Bytes, nonce Bytes, keyVersion int (FK→
    Fl_CryptoKey.version where purpose='vault-kek'), rotateBy?,
    lastAccessedAt?, replacedAt?, createdBy, createdAt, updatedAt }`.
  - `Fl_CredentialDisclosureLog { id, credentialId FK, viewedBy
    email, viewedAt, justification text, ip text, userAgent text }`.
- `lib/with-audit.ts` extended with a `redactKeys?: string[]`
  option. When set, the named keys are replaced with `[REDACTED]`
  in the persisted `detailJson` before the audit row is hashed
  into the chain. Disclose path uses `redactKeys: ['plaintext',
  'newPlaintext']`. Ships BEFORE the disclose route.
- Slack-webhook migration: a one-shot script
  (`scripts/migrate-slack-secrets-to-vault.ts`) reads every
  `Fl_AlertRoute.channelsJson`, finds Slack webhook URLs, calls
  `seal()` per route, replaces the plaintext URL in the JSON with
  `{ credentialId, masked: "…last4" }` for round-trip. The
  alert-channels adapter (`lib/alert-channels.ts`) gains a
  `resolveSlackWebhook(channelEntry)` step that detects the new
  shape and calls `unsealForSystemUse(credentialId)` — a special
  unseal path that writes a `system:alert-channels` actor to the
  disclosure log without requiring step-up (because the alert
  dispatcher is the server itself).
- `/credentials/[id]` page (read-mode only in WS-A): shows label,
  kind, tenant, last-accessed-at, rotate-by, who created.
  `<MaskedField>` shows `••••••••••••last4`. "Disclose" button
  ships in WS-B (gated on step-up + 4-eyes for HIPAA tenants).
- `/clients/[name]?tab=settings` Policies subtab (full landing in
  WS-D) gains a "Credentials" Group with the per-tenant credential
  list + "+ Add credential" form. Form calls `seal()` server-side
  via a new `POST /api/admin/credentials` route (audit-wrapped,
  `redactKeys: ['plaintext']`).

**Workstream B — 4-eyes approval workflow:**

- New Prisma model:
  - `Fl_ActionApproval { id, action string (e.g. "bulk.dispatch",
    "shell.open", "credential.disclose", "credential.update",
    "alert-route.delete", "oncall-schedule.delete"), tenantName,
    payloadJson Json (the action's parameters), payloadHash text
    (SHA-256 of canonical payloadJson — gate against payload
    swap-after-approval), requestedBy email, requestedAt, scope
    string (e.g. device-tag, group-id, alert-route-id),
    requiredRole enum ('admin' | 'manager'), state enum
    (pending/approved/denied/expired), approverEmail?, approvedAt?,
    denyReason?, expiresAt }`.
- New `/approvals` inbox page (sibling of `/alerts`). Lists
  pending approvals for the viewing operator with: action verb,
  requesting operator, tenant, scope, payload preview, "Approve"
  + "Deny" buttons. Approve writes `approverEmail` + `approvedAt`,
  emits `approval.granted` audit row, computes approval token via
  `signApprovalToken({ approvalId, payloadHash })`, dispatches
  the original verb. Deny writes `denyReason`, emits
  `approval.denied`, no dispatch.
- `lib/approval-gate.ts` (server-only):
  - `requireApproval({ action, tenantName, payload, scope,
    actorEmail })` → checks per-tenant policy: if the actor's
    own approval suffices (single-operator tenants, dev tier),
    auto-approves. Otherwise creates `Fl_ActionApproval`,
    emits `approval.requested` audit row + a Cmd-K-inbox ping
    to ADMINs in the tenant, returns 202 with approval id.
  - `consumeApproval({ approvalId, action, payloadHash })` →
    verifies state='approved', payloadHash matches, expiresAt
    not yet, returns ok. Race-safe via a `UPDATE … WHERE
    state='approved' RETURNING …` conditional flip to
    `consumed`.
- Wrapping verbs:
  - `POST /api/devices/maintenance/bulk` — wraps when `deviceIds`
    count exceeds the tenant's `bulkApprovalThreshold` (default 50).
  - `POST /api/deployments` + `POST /api/scripts/[id]/run` +
    `POST /api/patches/[id]/deploy` — wrap when resolved
    `deviceIds.length` > threshold OR `action='uninstall'` on
    any count > 0.
  - `POST /api/devices/[id]/shell` (shell.open) — wraps when the
    device has tag matching the tenant's `shellApprovalTags[]`
    (e.g. `['prod','finance']`). Per-device-tag scope so
    peer-approval doesn't get treated as rubber-stamp noise on
    dev/lab hosts.
  - `POST /api/credentials/[id]/disclose` (NEW route, ships
    HERE) — always wraps for HIPAA tenants; per-tenant
    `disclosureRequiresApproval` toggle for non-HIPAA. Step-up
    auth (WS-C) is independent of 4-eyes (both required for HIPAA).
  - `PATCH /api/credentials/[id]` (update plaintext) — wraps
    when tenant has `disclosureRequiresApproval=true` (same
    policy — rotating a stored secret without peer review lets
    a rogue admin lock peers out).
  - `DELETE /api/alert-routes/[id]` + `DELETE /api/oncall-schedules/[id]`
    — wraps always (destructive on shared infrastructure).
  - **Not wrapped: `POST /api/backups/trigger`** — audit it
    instead (reversible, additive; gating breeds approval fatigue).
- `<ApprovalGate>` client HOC wraps existing destructive UI
  buttons. On submit: POST to the original endpoint. If response
  is 202 with `{ approvalId }`, shows an "Awaiting peer approval"
  toast with the approval id + a "Cancel request" link. When the
  approver clicks Approve, the dispatcher re-fires the original
  verb server-side using `consumeApproval` — the original client
  is *not* polled.
- New audit verbs (4): `approval.requested`, `approval.granted`,
  `approval.denied`, `approval.consumed`. All hash into the chain.

**Workstream C — WebAuthn + MFA hardening:**

- New Prisma model:
  - `Fl_WebAuthnCred { id, userId FK→Fl_StaffUser, credentialId
    Bytes (raw), publicKey Bytes, signCount BigInt, transports
    String[] (usb / nfc / ble / internal), name String (operator-
    chosen e.g. "MacBook TouchID"), aaguid Bytes?, createdAt,
    lastUsedAt? }`. Single user can have multiple credentials.
- `@simplewebauthn/server` v11 dependency. Relying-party id and
  origin sourced from `FLEETHUB_PUBLIC_URL` host. RP signing key
  lives in `Fl_CryptoKey purpose='webauthn-rp'` (asymmetric,
  public-only; private not needed for server-side verification).
- New routes:
  - `POST /api/auth/webauthn/register/options` — generates
    registration challenge.
  - `POST /api/auth/webauthn/register/verify` — verifies
    attestation, writes `Fl_WebAuthnCred`.
  - `POST /api/auth/webauthn/authenticate/options` — generates
    auth challenge.
  - `POST /api/auth/webauthn/authenticate/verify` — verifies
    assertion, returns step-up token via
    `signApprovalToken({ userId, expMs, purpose:'step-up' })`.
  - `POST /api/auth/mfa-stepup` (alt path for TOTP-only users)
    — verifies a fresh TOTP, returns the same step-up token
    shape so disclose/approve paths only consume one verb.
- Step-up token: HMAC-signed, 5-minute TTL, single-use (server
  caches consumed-token-ids in `Fl_StepUpConsumed` table,
  TTL-purged by a new cron). Disclose + approve paths require
  a `X-FleetHub-StepUp` header.
- `app/api/auth/mfa-verify/route.ts` hardening (lands EARLY):
  - Route input shape switches from `{ token: string }` to
    `{ code?: string, recoveryCode?: string }` (field-based,
    not length-based). Old 6-char length heuristic deleted.
  - Adds `Fl_StaffUser.mfaFailCount` + `mfaLockedUntil`. 5
    failures within 10 minutes → 15-minute lockout. Audit
    `mfa.locked` on transition. Counter resets on success.
- Recovery-code regeneration:
  - `Fl_StaffUser.recoveryCodesJson` already exists. Add a
    response field `remainingCount` to whichever route renders
    `/setup/staff/[id]?tab=mfa` (or self-service `/account/security`).
  - New `POST /api/admin/staff/[id]/mfa/regenerate-recovery`
    requires a fresh TOTP, generates 10 new codes, replaces
    `recoveryCodesJson`, returns the cleartext once (shown-once
    UI pattern).
- `/account/security` page (NEW, public route group, not under
  `/setup`): self-service MFA enrollment + WebAuthn enrollment
  + recovery code countability + "Regenerate codes" button.
  Middleware redirects forced-enrolling users HERE (today they
  hit `/setup/staff/[id]` which is admin-only — chicken-and-egg).
- `lib/auth-options.ts` JWT-refresh fix (lands EARLIEST in WS-C,
  10-line change): hoist the
  `Fl_Tenant.findFirst({ where: { mfaRequired: true } })` and
  `Fl_StaffUser.findUnique({ select: { totpEnabledAt: true }})`
  reads outside the `if (user)` guard so they run on every JWT
  refresh, not only initial sign-in. Acceptable cost: 2 indexed
  queries per refresh; JWT refresh interval is operator-tunable
  in NextAuth config if this becomes hot.

**Workstream D — Policies subtab + cross-tenant sweep:**

- `TenantSettingsTab.tsx` refactor: 300-line stacked-Group scroll
  → left-rail nested-tab nav. Subtabs in order:
  - **Security** — MFA-required, mfaRequiredEnforcedAt,
    sessionMaxHours (NEW from Phase 11), passwordExpiryDays.
  - **Remote** — remoteAccessEnabled, remoteSessionDefaultDurationMin,
    remoteRequiresJustification, rustdeskMode, shellApprovalTags[]
    (NEW).
  - **Portal** — portalEnabled, portalReportMaxAgeDays,
    portalReadOnlyMode.
  - **Backup** — backupMonitoringEnabled, mutableBackupEnabled,
    backupRetentionDays.
  - **Shell** — shellEnabled, shellSessionMaxMinutes,
    shellRequiresJustification, shellApprovalTags[].
  - **File transfer** — fileTransferEnabled, fileTransferMaxSizeMb,
    fileTransferAllowedDirs[].
  - **Integrations** — psaSyncEnabled, psaTenantId, qbrAutoNarrative,
    aiProxyTokenSet.
  - **Policies** (NEW) — bulkApprovalThreshold,
    disclosureRequiresApproval, peerApprovalReminders,
    Credentials list (from WS-A), Maintenance-windows-list
    placeholder (deferred to Phase 12).
- `/admin/policies` page (NEW, ADMIN-only, sibling of `/setup`):
  - Top section: tenant-row × policy-column matrix. Columns:
    MFA-required, Bulk-approval threshold, Disclosure requires
    approval, Shell approval tags, Mutable backup. Edit-in-place
    per cell with Save row → batched PATCH per tenant. Audit
    each cell change individually so the per-tenant detail
    survives the bulk operation.
  - Bottom section: "Apply across N tenants" form — pick a
    policy + value, multi-select tenants, single submit. Audit
    rows one-per-tenant, each via `withAudit({ action:
    'tenant.policy.bulk-set' })`.
- 13 missing tenant-settings toggles (named in Phase 10 §13 +
  the UX audit) surface as actual UI controls in their subtabs.
  Nothing operator-as-Prisma remains for tenant policy.

**Workstream E — UI primitives III + tech-debt close:**

- New primitives in `components/ui/`:
  - `MaskedField.tsx` — props `{ value, label, copyable?,
    onReveal? }`. Defaults to `••••••••last4`. Reveal toggle
    is a `<Button size="xs" variant="ghost">` w/ eye icon
    (emoji 👁). Copy-to-clipboard calls `onReveal` so the
    disclosure-log row gets a `'copy-to-clipboard'` justification.
  - `NotificationBadge.tsx` — props `{ count, max?, tone? }`.
    6px dot when count=0, numeric bubble when count > 0,
    `99+` when count > max (default 99). Used on sidebar
    Approvals link.
  - `Table.tsx` + `<TH>` / `<TD>` named exports. fontSize 12.5px
    (the most-common drift target), 0.5px border-bottom, label-
    caps style for `<TH>` via `LABEL_CAPS` token. Wraps the
    existing `<table>` element 1:1 — sites adopt by `<Table>` /
    `<TH>` / `<TD>` swap, no other changes needed.
- Primitive extensions:
  - `Button` gains `size="xs"` (10.5px, padding "1px 6px",
    height 22px). `NotesCard.tsx` and `MfaChallengeForm.tsx`
    drop their `iconBtn` hand-rolls.
  - `Chip` gains `interactive?: boolean` + `active?: boolean`
    + optional `as?: 'span' | 'a'`. `/audit/page.tsx`
    `QuickRangePresets` drops its hand-rolled chip CSS.
  - `StatCard` gains `size?: "sm" | "lg"` prop (sm=18px,
    lg=28px existing). `/software`, `/clients/[name]`,
    `/reports`, `/patches` drop their `Tile` clones.
- Adoption sweep, scope-controlled:
  - `<Table>` adopted on the 5 highest-traffic list pages
    (audit, devices/[id], monitors, deployments, patches).
    The remaining 20 lists tracked in a follow-up issue
    explicitly, NOT in this phase.
  - `StatCard size="sm"` adopted on the 4 named pages
    above. Tile clones deleted.
- Visual / interaction fixes:
  - `NotesCard.tsx` SSR/CSR FOUC: server-side call
    `renderMarkdownSafe()` returns the same sanitized HTML
    rendered client-side. No mono-pre-wrap fallback. The
    function is already sanitize-safe per its comment so this
    is a no-risk SSR adoption.
  - Device-notes `_count.notes` projection added to
    `listDevices()`. `DeviceTable` row renders a 📝 emoji
    chip when count > 0.
  - `/devices/[id]?tab=alerts` banner when device has notes
    with `pinned=true` ("⚠ This device has pinned notes.
    Read before acting.").
- `lib/markdown.ts` hardening:
  - DOMPurify config: `ALLOWED_URI_REGEXP: /^(https?:|mailto:|#)/i`
    explicit (blocks `data:`, `javascript:`, `vbscript:`, etc.
    — DOMPurify default rejects `javascript:` but is permissive
    on others).
  - `addHook('afterSanitizeAttributes', node => { if
    (node.tagName === 'A') { node.setAttribute('rel',
    'noopener noreferrer'); if (node.getAttribute('target')
    === '_blank') { /* ok */ } else { node.setAttribute(
    'target', '_blank'); } } })`.
- `middleware.ts` matcher tightening: convert prefix exclusion
  list to a proper anchored regex, drop the favicon-prefix
  bug, explicit exclude only `_seed` in dev (gate via env
  `NODE_ENV !== 'production'`), audit all `/api/_seed/*`
  routes to confirm they self-gate on `NODE_ENV` too.
- `Fl_AuditLog.reviewStatus` enum (`unreviewed` | `reviewed` |
  `flagged`) + `reviewedBy?` + `reviewedAt?`. `/audit` quick-range
  pill row gains "High-risk unreviewed" (filters
  `action IN ('approval.granted', 'credential.disclose',
  'tenant.policy.bulk-set', 'crypto.key.rotated') AND
  reviewStatus = 'unreviewed'`). Row-level "Mark reviewed"
  button.
- Phase-9 cron-secret fallback delete:
  `lib/with-cron-auth.ts` removes the `FLEETHUB_AGENT_SECRET`
  fallback branch. 14 cron routes already accept the new
  `FLEETHUB_CRON_SECRET`; the shim was a one-release grace
  that expires here. Migration step required: operator
  rotates cron crontab to use the new secret BEFORE deploying
  this phase (see §11).
- New vitest files:
  - `tests/credential-vault.test.ts` (seal→unseal roundtrip,
    tampered ciphertext, wrong tenant DEK, rotation rewrap).
  - `tests/crypto-key.test.ts` (`getActiveKey` cache,
    `rotateKey` audit-row emit, sign/verify approval token).
  - `tests/approval-gate.test.ts` (requireApproval state
    transitions, payloadHash mismatch refusal, consume
    race-safety).
  - `tests/mfa-cookie.test.ts` (mint→verify roundtrip,
    tampered sig, expired, malformed — closes the Phase-10
    gap).
  - `tests/mfa-verify-route.test.ts` (TOTP success/fail,
    recovery success/fail, 5-strike lockout — closes the
    Phase-10 gap).
  - `tests/markdown-xss.test.ts` (`<script>`, `<img onerror>`,
    `javascript:`, `data:text/html`, `vbscript:`, target+rel
    autoinject — closes the Phase-10 gap).
  - `tests/agent-ingest-envelope.test.ts` (shell.exited,
    file.transfer.complete, backup.complete handlers — closes
    the Phase-10 gap).

---

## 2. Schema deltas

**All additions pure-additive. No DROP. No NOT NULL on existing
columns. No column renames. DB backup taken BEFORE
`prisma migrate deploy` per the standing no-data-loss
constraint.**

New tables (8):
- `Fl_CryptoKey`
- `Fl_Credential`
- `Fl_CredentialDisclosureLog`
- `Fl_ActionApproval`
- `Fl_WebAuthnCred`
- `Fl_StepUpConsumed`

New columns on existing models:
- `Fl_StaffUser`: `mfaFailCount Int @default(0)`, `mfaLockedUntil
  DateTime?`
- `Fl_Tenant`: `bulkApprovalThreshold Int @default(50)`,
  `disclosureRequiresApproval Boolean @default(false)`,
  `peerApprovalReminders Boolean @default(true)`,
  `shellApprovalTags String[] @default([])`,
  `sessionMaxHours Int @default(12)`,
  `passwordExpiryDays Int @default(0)`
- `Fl_AuditLog`: `reviewStatus String @default("unreviewed")`,
  `reviewedBy String?`, `reviewedAt DateTime?`

New enums (Prisma-side; Postgres-side as TEXT):
- `CryptoKeyPurpose`: `vault-kek` | `webauthn-rp` |
  `approval-signing` | `ack-signing`
- `CredentialKind`: `admin-pw` | `api-key` | `wifi-psk` |
  `snmp-v3` | `smtp-password` | `webhook-secret` | `other`
- `ApprovalState`: `pending` | `approved` | `denied` | `expired` |
  `consumed`

---

## 3. The crypto primitive — design constraints

**Root key:** `FLEETHUB_CRYPTO_ROOT_KEY` env, 32 bytes base64. Loss
of this env = unrecoverable vault. Operator runs
`openssl rand -base64 32` once during Phase 11 deploy and stores
it in the password manager + offsite. **Not** in `.env.example`.

**Key hierarchy:**
1. Root key (env) wraps `Fl_CryptoKey` rows where
   `purpose='vault-kek'` (one active per phase rotation).
2. Active `vault-kek` wraps per-tenant DEK (deterministic from
   `tenantName + keyVersion` so multiple FleetHub processes can
   independently derive the same DEK without coordination).
3. Per-tenant DEK encrypts `Fl_Credential.ciphertext` (AES-256-GCM,
   12-byte nonce in `Fl_Credential.nonce`).

**Rotation:**
- `vault-kek` rotation: generate new key, rewrap every active
  `Fl_Credential` (read with old DEK, seal with new DEK), set
  old `retiredAt`. Bulk operation behind an admin-only
  `/admin/crypto/rotate` page (NOT in Phase 11 scope — manual
  via script for now).
- `webauthn-rp`: rotation invalidates all WebAuthn credentials
  (rare; operator-initiated only on suspected compromise).
- `approval-signing` + `ack-signing`: rotation invalidates
  outstanding signed URLs / tokens. 5-minute TTL on step-up
  + approval tokens means the window is small.

**Not in scope for Phase 11:** HSM integration, KMS hand-off,
multi-region key replication. Single-server single-process is
the deploy model for the foreseeable.

---

## 4. The 4-eyes state machine

```
                  requireApproval()
                          │
                          ▼
                    ┌─────────────┐
       ┌───expire──>│   pending   │
       │            └─────────────┘
       │              │         │
       │              │ approve │ deny
       │              ▼         ▼
       │       ┌─────────┐  ┌─────────┐
       │       │approved │  │ denied  │
       │       └─────────┘  └─────────┘
       │              │
       │      consumeApproval()
       │              │
       │              ▼
       │       ┌─────────┐
       │       │consumed │
       │       └─────────┘
       │
       └── after expiresAt (default 24h)
```

Transitions are audited individually. `payloadHash` is captured
at `pending` and verified at `consumed` — protects against
payload swap-after-approval (a known 4-eyes bypass class).

---

## 5. Hard ordering (§11)

The architect's gut-check called out five footguns. The phase
sequences around them:

1. **WS-A `Fl_CryptoKey` schema FIRST.** Nothing writes a server
   secret until this table exists. Approval-signing key (WS-B),
   WebAuthn RP key (WS-C), and the migrated alert-ack key
   (Phase 7 backport) all read from here. Migrating a key
   twice is the loss path; ship the table first.
2. **WS-A audit-redaction allowlist in `withAudit` BEFORE the
   disclose route ships.** The disclose route writes the
   plaintext into its request body, which `withAudit` would
   otherwise hash into the audit chain. Once a leaked plaintext
   is in the chain, it can't be removed without breaking the
   chain. This is the most expensive recoverable error in
   Phase 11. Test the redaction path before the disclose route
   exists.
3. **WS-C JWT-refresh fix EARLY.** 10-line change in
   `lib/auth-options.ts`. Without it, flipping
   `Fl_Tenant.mfaRequired=true` doesn't gate live sessions, and
   every WS-C / WS-B test will silently pass against unenforced
   policy. Lands as the first WS-C commit.
4. **WS-C mfa-verify field-routing fix BEFORE WebAuthn enroll.**
   Today, a 6-char recovery prefix routes to TOTP verify and
   silently fails. Adding a third credential type on top of a
   buggy router compounds the failure modes.
5. **WS-C step-up endpoint BEFORE WS-A disclose route + WS-B
   ApprovalGate.** Both consume `X-FleetHub-StepUp`. Ship the
   producer first.
6. **WS-B `consumeApproval` payloadHash check BEFORE wrapping
   any verb.** Otherwise an approver-then-payload-swap bypass
   ships unguarded.
7. **WS-E Phase-9 cron-secret fallback delete LAST in WS-E.**
   Operator updates crontab to the new secret BEFORE deploy.
   Concretely: deploy WS-E with the fallback still in place
   (no behavior change), then rotate the operator's crontab,
   then deploy the fallback-delete commit. Two-deploy split if
   needed; the fallback line is a one-line conditional.

WS-D + WS-E run in parallel with the A/B/C chain. WS-E touches
no auth or crypto surface. WS-D touches only tenant-settings
JSON and is gated end-to-end on existing role checks.

---

## 6. Migrations + activation checklist

- [ ] DB backup (`pg_dump`) to
  `backup-dochub-pre-phase11-YYYYMMDD-HHMMSS.sql` immediately
  before `prisma migrate deploy`.
- [ ] `openssl rand -base64 32 > /tmp/crypto-root.txt`, paste
  into `fleethub/.env` as `FLEETHUB_CRYPTO_ROOT_KEY=`. Verify
  reload picked it up.
- [ ] `prisma migrate deploy`. Verify migration row count
  matches expected: 1 new migration, ~14 schema changes (8
  new tables + 8 new columns).
- [ ] Bootstrap initial keys: run
  `scripts/bootstrap-crypto-keys.ts` (new). Creates
  `Fl_CryptoKey` rows for `vault-kek` (v1),
  `approval-signing` (v1), `ack-signing` (v1 — backfilled
  from current NEXTAUTH_SECRET-derived secret),
  `webauthn-rp` (v1, generates Ed25519 keypair). Audited as
  `crypto.key.bootstrapped` (one row per purpose).
- [ ] Migrate Slack-webhook plaintext:
  `scripts/migrate-slack-secrets-to-vault.ts`. Dry-run first;
  print "would seal N entries". Operator confirms count
  matches expected `Fl_AlertRoute` row count. Then real run.
  Audited as `credential.seal` (one per webhook).
- [ ] Verify `lib/alert-channels.ts` picks up the new shape
  (smoke: send a test alert via existing test-alert script).
- [ ] Enroll the primary admin in WebAuthn at
  `/account/security`. Verify enroll → assert roundtrip.
- [ ] Set `disclosureRequiresApproval=true` on the HIPAA
  tenants via `/admin/policies`.
- [ ] Rotate crontab to `FLEETHUB_CRON_SECRET` (new).
- [ ] Deploy WS-E fallback-delete commit.

---

## 7. Phase 12 territory

The architect's gut-check pulled these out of Phase 11
explicitly. Phase 12 will be a network-monitoring + recording
phase:

- **Network device monitoring (SNMP v3 + ICMP).** Full new
  noun + probe pipeline + crons + page. Vault dependency is
  real but thin — Phase 11 ships the vault, Phase 12 ships
  the consumer.
- **Recurring tenant maintenance windows.** Cron-pipe feature,
  unrelated to crypto. Suppression logic deserves its own
  pass alongside alert-evaluator queue throttling
  (already-deferred v1.5 item).
- **Content-recording shell sessions.** Privacy infra; pair
  with recording UI + retention policy. Asciicast v2 + S3
  put.
- **Mutable AV/EDR management.** Cross-vendor verb sprawl;
  Defender + CrowdStrike scope first. Schema extends
  `Fl_BackupRun` pattern.
- **Process/service inspector.** Blocked on
  `AGENT-PROTOCOL.md` reservation of `fleet.services.*`
  namespace (`windows.services.*` is OpsHub-owned today).
  Phase 12 entry contingent on that decision landing.
- **Portal Tailwind→CSS-var bridge.** Portal-side phase;
  not FleetHub work.
- **Time-tracking on `Fl_RemoteSession` + `Fl_ScriptRun`.**
  4-line schema change + 1 column on each; not phase work,
  side-quest. Ships when an operator asks for TicketHub
  time-card sync.

---

## 8. Out-of-scope deliberate non-goals

- **HSM / KMS integration.** Single-server crypto root is
  acceptable for the deploy model. Revisit when a deploy
  target requires it.
- **Multi-region replication / sharded crypto.** Same.
- **Hardware-backed WebAuthn attestation policy.** Phase 11
  accepts any platform + cross-platform authenticator. Tighter
  attestation-cert validation is a Phase 13+ item if a
  compliance regime demands it.
- **Cross-tenant credential sharing.** Each `Fl_Credential` is
  tenant-scoped. No "shared vault" concept.
- **Vault-backed env injection at agent startup.** The vault
  serves operator-facing disclose flows + server-side resolve
  (Slack, SNMP). Agent credential injection is a Phase 13
  item if ever.
- **Approval chains > 1 deep.** 4-eyes is two-deep
  (requester + approver). No N-eyes, no quorum.

---

## 9. Test gates

- `npm run typecheck` clean.
- `npx vitest run` — must include the 7 new test files plus
  the existing 117 pass.
- `npx playwright test` — smoke set for `/credentials/[id]`,
  `/approvals`, `/account/security`, `/admin/policies`.
  (Existing smoke remains untouched.)
- Manual: Slack-webhook smoke after vault migration.
- Manual: WebAuthn enroll + assert roundtrip on at least one
  platform authenticator + one cross-platform (security key).
- Manual: bulk-dispatch above-threshold from one admin →
  approval inbox notification on second admin → approve →
  dispatch fires.
- Manual: credential disclose → step-up prompt → TOTP →
  disclosure log row visible at `/audit?action=credential.disclose`.

---

## 10. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Root crypto key lost | unrecoverable | Operator writes to password manager + offsite paper backup at deploy. Documented in §6 checklist. |
| Disclose path leaks plaintext into audit chain | high (chain unrecoverable) | `withAudit` redact-allowlist lands BEFORE disclose route. Tested via `credential-vault.test.ts`. |
| WebAuthn enrollment lockout (lost device + lost recovery codes) | medium | Recovery codes shown once; admin can regenerate via TOTP. Final fallback: admin-side disable-MFA on `/setup/staff/[id]?tab=mfa` (already exists). |
| 4-eyes payload-swap bypass | medium | `payloadHash` captured at request, verified at consume. State machine refuses re-use (`consumed` is terminal). |
| Cron-secret rotation outage | low (operational) | Two-deploy split — fallback delete is the last WS-E commit. Operator rotates crontab between deploys. |
| Slack-webhook migration fails partway | medium | Migration script is idempotent (skips already-sealed entries via JSON shape detection). Re-run is safe. |
| JWT-refresh DB-read per request becomes hot | low | 2 indexed queries on the `Fl_Tenant.mfaRequired` partial-index path. NextAuth refresh interval tunable if needed. |

---

## 11. Sequencing summary

```
WS-A.1 Fl_CryptoKey schema + lib/crypto-key.ts
WS-A.2 lib/with-audit.ts redact-allowlist + tests
WS-A.3 Fl_Credential + Fl_CredentialDisclosureLog schema
WS-A.4 lib/credential-vault.ts seal() + unsealForSystemUse()
WS-A.5 Slack-webhook migration script + alert-channels adapter
WS-A.6 /credentials/[id] read-mode page + MaskedField (from WS-E)

WS-C.1 lib/auth-options.ts JWT-refresh fix (FIRST WS-C commit)
WS-C.2 mfa-verify field-routing fix + lockout
WS-C.3 Fl_WebAuthnCred + Fl_StepUpConsumed schema
WS-C.4 webauthn enroll + verify routes
WS-C.5 mfa-stepup route + step-up token consumer
WS-C.6 /account/security self-service page
WS-C.7 recovery-code regenerate route + countability UI

WS-A.7 /api/credentials/[id]/disclose route + unseal() with step-up
WS-A.8 PATCH /api/credentials/[id] + Policies UI hook

WS-B.1 Fl_ActionApproval schema + lib/approval-gate.ts
WS-B.2 /approvals inbox + ApprovalGate HOC
WS-B.3 Wrap bulk dispatch + shell.open + credential.disclose
       + credential.update + alert-route.delete +
       oncall-schedule.delete
WS-B.4 Audit backup.trigger (not gate)

WS-D.1 TenantSettingsTab left-rail subtab refactor
WS-D.2 13 missing toggles surfaced + Phase-11 toggles wired
WS-D.3 /admin/policies cross-tenant sweep page

WS-E.1 MaskedField + NotificationBadge + Table primitives
WS-E.2 Button size="xs" + Chip interactive/active + StatCard sm
WS-E.3 NotesCard SSR fix + device-notes _count chip
WS-E.4 markdown.ts hardening + middleware matcher tightening
WS-E.5 Fl_AuditLog.reviewStatus + quick-range pill
WS-E.6 7 new vitest files
WS-E.7 Cron-secret fallback delete (LAST commit of phase;
       operator rotates crontab BEFORE this commit deploys)
```

Total expected commits: ~12-15 across the 5 workstreams.

---

## 12. Open questions deferred to in-flight decisions

- **Per-tenant step-up TTL override.** Default 5 min. HIPAA
  tenants may want shorter. Defer to in-flight — if it lands
  in WS-C, fine; otherwise Phase 12.
- **Approval inbox notifications via Slack/Teams.** The
  approval-routing channel question. v1 ships in-app only;
  re-using `lib/alert-channels.ts` for approval dispatch is
  a Phase 12 item.
- **Credential sharing across operators within tenant.** All
  ADMINs can disclose all tenant credentials in v1. RBAC on
  credential rows is a Phase 12 item if any operator asks.
- **`Fl_CryptoKey` rotation UI.** v1 manual via script. UI
  belongs with the maintenance-windows / cross-tenant-policies
  pattern in Phase 12.

---

## 13. Why these workstreams, why this phase

The Phase 10 design's §13 named eight Phase-11 candidates. The
architect's gut-check on this design pulled three out:

- **Network device monitoring (SNMP/ICMP)** — the architect
  called it a "Trojan horse" — pitched as needing the vault
  but actually a full new noun + probe pipeline + crons + page,
  i.e. a phase on its own. Phase 12.
- **Recurring tenant maintenance windows** — shares zero
  surface with the crypto bundle. Belongs with
  alert-evaluator queue throttling. Phase 12.
- **Content-recording shell sessions** — privacy infra; not
  load-bearing on shell.open shipping (Phase 10 already ships
  `shell.exited` ingest). Phase 12.
- **Mutable AV/EDR management** — verb sprawl across vendors;
  Phase 12.
- **Process/service inspector** — blocked on AGENT-PROTOCOL
  namespace reservation. Phase 12 entry conditional on that.

What's left — credential vault, WebAuthn, 4-eyes — share the
unified `Fl_CryptoKey` primitive. That's the architect's
"pair key infra in one phase" framing made literal: one table,
one rotation procedure, one audit verb, three consumers.

The two non-crypto workstreams (D + E) are the supporting
surface that makes the crypto useful: the Policies subtab is
where peer-approval thresholds + vault-access rules live;
the UI primitives are what `/credentials` + `/approvals` render
through. Without D + E, the crypto bundle ships as a
dev-tool only.

---

**End of design.**
