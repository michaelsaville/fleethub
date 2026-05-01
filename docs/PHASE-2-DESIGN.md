# FleetHub Phase 2 — Script Orchestration (Design)

**Status:** Draft, 2026-05-01. Not yet implemented. Phase 2 is gated on Phase 1.5 user-side activations completing + 24h+ of clean agent uptime per `project_fleethub_next_session.md`.

**Scope of this doc:** the design contract for `scripts.*` namespace methods, signed-script enforcement, dry-run UX, capability drops, output streaming, and the audit shape. This is the spec we'll implement against — deviations require updating this doc first.

**Cross-references:**
- [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) — wire protocol the methods piggyback on
- [`HIPAA-READY.md`](HIPAA-READY.md) §6 — signed-script-only enforcement constraint
- [`UI-PATTERNS.md`](UI-PATTERNS.md) — UI conventions for the new screens

---

## 1. What Phase 2 ships

Per FleetHub `README.md`:

> Phase 2 — Script orchestration. Adds `scripts.*` namespace, signed-script enforcement (HIPAA tenants), dry-run-default everywhere. Agent has to drop privileges per-command (the systemd unit `User=nobody` will need to flip to `User=root` + per-command capability drops).

Concretely, by the end of Phase 2:

- A tech can run a curated PowerShell or bash script on one host or a fleet selection, see live output streamed to the FleetHub UI, and cancel it mid-flight.
- HIPAA-tenant scripts are Ed25519-signed at the catalog tier; the agent refuses to execute anything whose signature doesn't verify.
- Every run is dry-run by default — operators must explicitly opt out via a checkbox or `--apply` argument.
- The agent runs the script body as a child process with a per-script capability set (the agent process itself runs as root + drops everything but the script-required caps before exec).
- Audit: every dispatch + complete + cancel writes to `Fl_AuditLog` with the script ID, body SHA-256, exit code, and per-line output digest. PHI leaves the agent only when explicitly opted in per-tenant.

## 2. Method signatures (agent-side)

Three new methods in the `scripts.*` namespace, dispatched by FleetHub through the gateway:

### `scripts.exec`

```jsonc
{ "method": "scripts.exec", "params": {
    "commandId": "<cuid>",          // server-minted, idempotent
    "scriptId": "<cuid>",           // catalog reference
    "scriptBody": "...",            // sent inline; agent verifies signature
    "scriptSig": "<ed25519-b64>",   // detached signature over scriptBody
    "scriptSha256": "<hex>",        // body digest; agent recomputes + checks
    "interpreter": "powershell" | "bash" | "cmd",
    "args": [...],                  // stringly-typed; quoted by agent
    "env": { "K": "v", ... },       // additional env (CommonName, Tenant, etc.)
    "dryRun": true,                 // default: true. False requires explicit
                                    //   `--apply` from the operator side.
    "timeoutSec": 300,              // hard kill at this point
    "outputBytesCap": 65536,        // agent uploads up to this much; rest →
                                    //   external store (S3-compatible) by URL
}}
```

Agent's response is a 202-equivalent (`scripts.exec.accepted`) with the `commandId` echoed back. Output streams via `scripts.output` frames.

### `scripts.output` (agent → server)

```jsonc
{ "method": "scripts.output", "params": {
    "commandId": "<cuid>",
    "stream": "stdout" | "stderr",
    "seq": 0,                       // monotonic per command
    "data": "<utf-8 chunk>",        // ≤4 KiB per frame to keep WSS happy
}}
```

The agent batches at ≤200ms intervals to avoid frame-storm. Backpressure is on — if the gateway buffer fills, the agent pauses the child process via `SIGSTOP`/`SuspendThread` until backpressure clears (this matters for `tail -f`-style pathological scripts).

### `scripts.complete` (agent → server)

```jsonc
{ "method": "scripts.complete", "params": {
    "commandId": "<cuid>",
    "exitCode": 0,
    "durationMs": 4231,
    "outputBytes": 12384,
    "outputUrl": "s3://...",        // null if outputBytes ≤ outputBytesCap
    "outputSha256": "<hex>",        // digest of the full output (any cap)
}}
```

### `scripts.cancel` (server → agent)

```jsonc
{ "method": "scripts.cancel", "params": {
    "commandId": "<cuid>",
    "reason": "operator-cancel" | "timeout" | "client-disconnect"
}}
```

Cancel is best-effort: agent sends `SIGTERM` then `SIGKILL` after a 5-second grace; on Windows it's `TerminateJobObject`. The `scripts.complete` frame still fires with the exit code observed.

## 3. Signed-script enforcement

Per HIPAA-READY §6. Every catalog script is signed at upload time by an Ed25519 keypair held by the tenant's compliance officer. The public key is written to `Fl_Tenant.scriptPublicKeys` (JSON array — supports rotation).

- **Server side:** `Fl_Script.bodyEd25519Sig` is required for any script tagged `requiresSignature=true` in any tenant marked `hipaaMode=true`. Upload UI rejects the row if signature is missing or doesn't verify against any of the tenant's current public keys.
- **Agent side:** `scripts.exec` carries `scriptSig` + `scriptSha256` + `scriptBody`. Before exec the agent:
  1. Recomputes SHA-256 of the literal `scriptBody` bytes.
  2. Compares against `scriptSha256`. Mismatch → reject with `script-body-tampered`.
  3. Verifies `scriptSig` is a valid Ed25519 signature of `scriptSha256` against the agent's locally-cached tenant public-key set (synced via `agent.config` push from server).
  4. Mismatch on signature → reject with `script-sig-invalid`.

Rejection is recorded as a `scripts.complete` with `exitCode=-1` + `error=script-sig-invalid` + a synthetic `scripts.output` carrying the rejection reason (so the operator sees something instead of an empty pane).

**Out-of-tenant signing keys:** operator-side hardware-backed key (YubiKey, TPM-bound). PCC2K's own scripts are co-signed by the platform key + the tenant key. This means revoking a tenant key locks them out of platform updates too — a feature, not a bug, since they should be running known-good versions for compliance.

## 4. Dry-run as the default

Every script invocation defaults to `dryRun=true`. The operator UI:

- Default checkbox is "Dry run" (unchecked = apply changes; toggle has explicit confirmation when unchecked + on a HIPAA tenant).
- Scripts that don't honor dry-run signal it via a `dryRunCapable: false` field in the catalog row. The UI greys out the apply path and forces dry-run if dry-run isn't supported.
- The agent passes `dryRun=true` to the script via env (`PCC2K_DRY_RUN=1`) and as the first arg if the script's catalog metadata declares `dryRunArg`. PowerShell scripts default to `-WhatIf`; bash to `--dry-run`. Operators can override per-script in the catalog.

## 5. Privilege model

The systemd unit currently runs as `User=nobody` (Phase 1, read-only inventory). Phase 2 needs the unit to flip to `User=root` so the agent can `setcap`/`drop_caps` on each script invocation. Trade-off: a compromised agent process now has full root, vs Phase 1's nobody. We accept this in exchange for capability-bounded children.

**Capability set per script:**

```yaml
# In Fl_Script.capabilities — JSON array of CAP_* names. The agent
# does CAP_PERMITTED & CAP_INHERITABLE = exactly this set, then
# execve()s the interpreter. Anything not in the list is unavailable
# to the script and any subprocess it spawns.

requiredCaps:
  - CAP_NET_ADMIN     # for scripts that touch firewall/iptables
  - CAP_SYS_TIME      # for time-sync scripts
  - CAP_DAC_READ_SEARCH  # for scripts that read /var/log/* without owning it
```

Default for new scripts: empty set (so the script runs as the equivalent of an unprivileged user, even though the agent itself is root). Operators must explicitly add caps.

**Windows equivalent:** `JobObject` with restricted token. The agent creates a Job, sets `JobObjectExtendedLimitInformation` (kill on parent close, no breakaway), and applies a `RestrictedSidsAndPrivileges` token that drops everything except the explicit allowlist. The capability list maps to Windows privileges (`SeChangeNotifyPrivilege` etc.) via `Fl_Script.windowsPrivileges`.

**macOS:** TBD. Phase 2.5 — macOS scripts run as root unrestricted in the first cut.

## 6. Output streaming + storage

Streamed line-buffered (newline) chunks ≤ 4 KiB each, batched ≤ 200ms. Total cap per command (`outputBytesCap`, default 64 KiB).

- If output stays under the cap, it lives inline in `Fl_ScriptRunOutput` (TEXT column).
- If output exceeds the cap, the agent uploads the full transcript to an S3-compatible bucket (per-tenant key prefix), and `scripts.complete.outputUrl` points at it. The UI then shows the inline 64 KiB head + a "download full transcript" link.

Per HIPAA spec: agent never logs file *contents* by default. Scripts that need to output file contents must declare `outputContainsContent: true` in the catalog, which forces the per-tenant opt-in flag check.

## 7. Audit shape

Every command writes 2-3 rows to `Fl_AuditLog`:

- `scripts.dispatch` — at server-side dispatch (operator clicked Run). Includes operator email, scriptId, scriptSha256, dryRun flag, target deviceId(s), capabilities granted.
- `scripts.complete` — when the agent reports complete. Includes exitCode, durationMs, outputSha256, outputBytes.
- `scripts.cancel` — only if cancelled. Includes reason, by whom (operator email or "system").

The chain (`prevHash`/`rowHash`) per HIPAA-READY §2 is unchanged — these new event types just slot into the existing chain.

## 8. UI surfaces

New screens:

- **`/scripts/[id]/run`** — script-execution form. Target picker (single device, multi-device, fleet filter). Dry-run checkbox (default checked). Args + env editor for parameterized scripts. Big red "Apply" button gated behind a confirmation when dry-run is off.
- **`/runs/[commandId]`** — live-output view. Splits stdout/stderr into two columns. Auto-scroll with a "follow tail" toggle. Cancel button (admin only). On complete: exit code badge, duration, "view full transcript" if uploaded to S3.
- **`/scripts`** — catalog list. Sortable by signed/unsigned, last-run-at, average duration. Curated tab vs Drafts tab (existing pattern). New "Sign" action for HIPAA-tenant admins — opens the YubiKey-touch flow.

Existing screen updates:

- **`/devices/[id]?tab=scripts`** — currently shows mock script-run history (`Fl_ScriptRun`). Phase 2 makes this live and adds a "Run a script…" CTA that deep-links into `/scripts/[id]/run?targetDeviceId=…`.
- **Cmd-K Pages category** — adds `Run script` as a top-level action.

## 9. Schema additions

```prisma
model Fl_Script {
  // ... existing fields ...
  bodyEd25519Sig  String?
  bodySha256      String
  requiresSignature Boolean @default(true)
  dryRunCapable   Boolean  @default(true)
  dryRunArg       String?  // e.g. "-WhatIf" or "--dry-run"
  capabilities    Json?    // string[] of CAP_* names
  windowsPrivileges Json?  // string[] of SeXxxPrivilege names
  outputContainsContent Boolean @default(false)
}

model Fl_ScriptCommand {
  id          String   @id @default(cuid())  // commandId — agent-facing
  scriptId    String
  script      Fl_Script @relation(...)
  deviceId    String
  device      Fl_Device @relation(...)
  operatorEmail String
  dryRun      Boolean
  argsJson    Json
  envJson     Json
  status      String   // "pending" | "running" | "complete" | "cancelled" | "rejected"
  exitCode    Int?
  durationMs  Int?
  outputBytes Int?
  outputUrl   String?  // S3 URL when overflow
  outputSha256 String?
  rejectReason String?
  startedAt   DateTime @default(now())
  completedAt DateTime?
}

model Fl_ScriptRunOutput {
  commandId   String   @id
  command     Fl_ScriptCommand @relation(...)
  stdoutBody  String   // up to outputBytesCap
  stderrBody  String
}

model Fl_Tenant {
  // ... existing fields ...
  hipaaMode             Boolean @default(false)
  scriptPublicKeys      Json    // string[] of base64 Ed25519 pubkeys
}
```

## 10. Sequencing inside Phase 2

Bite-sized landings:

1. **Schema + protocol freeze** — land the schema, protocol additions in `AGENT-PROTOCOL.md`, this design doc. Nothing executable yet.
2. **Catalog UX** — ship `/scripts/[id]/edit` with the new fields (cap selector, dryRunCapable checkbox, signing button stub). Curated scripts get the new shape; runs are still mocked.
3. **Agent execution path (Linux)** — agent gains `scripts.exec` handler. Privilege-drop via `prctl(PR_SET_KEEPCAPS)` + `setresuid` + `cap_set_proc`. Dry-run honored via env. Output streamed in 4KiB chunks.
4. **Server-side dispatch** — `scripts.exec.dispatch` server action writes Fl_ScriptCommand, signs the envelope, hands off via gateway. Live-output view connects.
5. **Signing flow** — Ed25519 verify in agent. Tenant key UX.
6. **Windows path** — JobObject + restricted token + PowerShell host. Catch up to Linux feature set.
7. **HIPAA-mode soak** — flip `hipaaMode=true` for one tenant, prove signed-only enforcement holds.

Each step is a shippable container restart. Nothing is "all-or-nothing" — the catalog UX without execution is still a UX win for the existing mock-driven runs.

## 11. Open questions

- **macOS execution model.** Phase 2.5? Mac MDM tooling makes per-script capability drops awkward — endpoint security frameworks expect the binary to be signed and notarized for kernel hooks, not for per-process capabilities.
- **Output-bytes overflow storage.** S3-compatible is the obvious answer but introduces a new dependency. Alternatives: Postgres LO, an on-disk cache on the FleetHub server. The S3 path scales further but adds an ops surface.
- **Multi-device fan-out.** Phase 2 first cut is one command per device per dispatch (1:1). A "run on 50 devices" click really creates 50 commands. Phase 2.5 might add a `Fl_ScriptCampaign` parent that aggregates progress across the fan-out.
- **Operator MFA gate.** Should toggling dry-run off require a re-auth touch? HIPAA spec doesn't mandate it but it's cheap insurance against operator-fatigue mishaps. Lean toward yes for `hipaaMode=true` tenants.
- **Cancellation race.** If `scripts.cancel` arrives after the child process exits but before `scripts.complete` flushes, what status wins? Lean toward whichever timestamp lands first server-side.

## 12. Non-goals (kept out of scope for Phase 2)

- Interactive shell sessions (Phase 6+, if ever)
- Script scheduling beyond cron-like (`runEveryMinutes` on `Fl_Script`) — full scheduler is Phase 5
- Cross-tenant script sharing (each tenant has its own catalog)
- Approval workflows ("script needs sign-off from a second admin before it runs") — defer to Phase 3
- Patch-management hooks (Phase 4 territory)
- Output diffing across runs ("show me what changed since last run")

These are valuable, just not Phase 2 valuable.
