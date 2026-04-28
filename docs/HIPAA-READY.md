# HIPAA-ready by construction

Design constraints for FleetHub + the PCC2K-Agent, locked before code
lands. HIPAA compliance for an RMM that touches healthcare clients
isn't a certificate you apply for — it's a set of safeguards you
demonstrate. This doc is the engineering side of that demonstration.

The non-engineering side (BAAs, Security Risk Assessment per NIST
SP 800-66, workforce training, incident-response plan) lives in the
PCC2K policy binder, not this repo.

---

## What HIPAA actually requires of an RMM

The HIPAA Security Rule (45 CFR Part 164, Subpart C) defines three
categories of safeguards:

- **Technical** (§164.312): access control, audit controls, integrity,
  authentication, transmission security
- **Administrative** (§164.308): policies, training, incident response,
  business associate contracts
- **Physical** (§164.310): facility access, workstation security,
  device/media controls

Of these, **technical safeguards drive the code**. Administrative and
physical safeguards drive PCC2K's operations and are out of scope here.

There is **no government-issued HIPAA software certification**. What
you can do (in increasing rigor and cost):

| Path | Cost | Time | Strength |
|------|------|------|----------|
| Self-attestation + SRA | ~free, ~1 wk | continuous | required minimum |
| Independent pentest | $5–15k | 2–4 wks | catches the obvious holes |
| SOC 2 Type II | $30–100k | 6–12 mo | sales-grade external assurance |
| HITRUST CSF certification | $60–200k+ | 12+ mo | gold standard |

For internal use across PCC2K's healthcare clients, we're targeting
**self-attestation + a one-time pentest before the first PHI-handling
deployment**. SOC 2 / HITRUST aren't on the table until/unless we sell
this externally.

---

## Engineering constraints (locked)

### 1. Encryption everywhere

- **In transit:** TLS 1.2+ for every hop. Agent → server WSS, browser →
  server HTTPS, server → Postgres `sslmode=require` (Phase 1+ once we
  introduce a non-loopback DB connection). No HTTP listeners except
  the certbot HTTP-01 challenge port.
- **At rest:** Postgres on the dochub host runs on a LUKS-encrypted
  volume (server-level — verify in PCC2K infra docs). Application-level
  encryption for PHI-adjacent fields (audit-log free-form `detailJson`,
  any captured command output) using a per-tenant key derived from a
  master key in a Vault-style secret store. **Phase 1+ feature; Phase
  0 fields are non-PHI.**
- **Agent local cache:** the agent caches some state on disk (config,
  pending command queue if disconnected). Cache file is AES-256-GCM
  encrypted with a key derived from the agent's machine GUID + the
  enrollment secret. Re-derived on each start; not stored.

### 2. Audit log is append-only and hash-chained

- Every privileged action (every Graph mutation, every agent command,
  every login, every consent-state write) creates a row in
  `op_audit_log` (or `fleet_audit_log` for FleetHub).
- **No DELETE, no UPDATE.** Schema has no DELETE policy at the DB role
  level — the `dochub` Postgres user must be REVOKEd from
  `DELETE / UPDATE` on the audit table. Application code never issues
  either.
- Each row has `prev_hash` (SHA-256 of the previous row's full content)
  and `row_hash` (SHA-256 of this row's content + prev_hash). Tampering
  with any historical row breaks the chain — verifiable on demand by a
  read-only verifier endpoint.
- **Retention: 6 years minimum** (HIPAA §164.530(j)(2)). Backup
  retention policy enforces; rows are never expired in-place.

### 3. Authentication + access control

- All staff sign-in via Entra SSO (existing PCC2K app reg) with **MFA
  required at the IdP level**. Configure CA policy in Entra to enforce
  MFA for OpsHub + FleetHub — not the apps' job to enforce, but apps
  log the `amr` claim and refuse sessions without `mfa`.
- Per-app allowlist (`op_staff_users` / `fleet_staff_users`) keyed by
  email. Removing access in Entra **and** flipping `is_active=false`
  in the allowlist; either alone closes the door.
- **Role-based scoping per client** is enforced server-side on every
  privileged action. Even ADMIN role is bound to "may act on which
  clients" — implemented as a join row `fleet_staff_client_scope`.
  Junior tech might have `clients = [* except client-X]` because
  client-X is a healthcare org with extra background-check
  requirements.
- **Automatic session timeout: 15 minutes idle.** NextAuth JWT TTL +
  client-side activity tracker. Configurable per-app, defaulting to
  HIPAA-friendly 15 min.

### 4. Code signing for the agent

- The PCC2K-Agent Windows MSI **must be Authenticode-signed with an EV
  certificate**. Cost ~$300–700/yr; non-negotiable. Unsigned binaries
  installed into clinical-network Windows hosts will be flagged by AV/
  EDR (Defender SmartScreen, CrowdStrike, SentinelOne) and silently
  prevented from running.
- Linux + macOS builds have lower-stakes signing requirements but we
  still notarize the macOS package (Apple Developer cert, separate
  $99/yr) and ship signed `.deb` / `.rpm` packages for Linux.
- **Reproducible builds**: the agent build pipeline produces
  byte-identical binaries from byte-identical sources. Lets clients
  (or their auditors) verify the signed binary matches the published
  source. Implemented via Go's `-trimpath` and `-buildvcs=false`,
  plus pinned dependency versions.

### 5. PHI-aware logging

- The agent **never logs file contents** by default. Commands that
  read files (`windows.eventLog`, `inventory.installed_apps`) extract
  metadata only. If a future feature needs to read file contents,
  it requires explicit per-tenant opt-in plus encryption of the
  output before transit.
- **No screenshots**, ever. itmanager.net offers screenshot-on-demand;
  we don't, because screenshots of clinical workstations are PHI by
  definition.
- **Session recording (RDP/VNC) is opt-in per client.** When enabled,
  recordings are encrypted at rest with per-tenant keys and have
  their own retention policy (default 90 days, separate from audit-log
  retention).

### 6. Script orchestration constraints (Phase 2)

- **Signed-script-only enforcement for HIPAA tenants.** Each script
  before execution is verified against a per-client allowlist of
  signed-script hashes. Operator submits a script → it's hashed and
  signed by an OpsHub admin → only then can it be queued for execution
  on the tenant's agents. Prevents an attacker who compromises the
  console from executing arbitrary code on healthcare-client hosts.
- **Dry-run by default.** Every script run defaults to `dry_run=true`,
  reporting what it WOULD do. Operator must explicitly check a "really
  run this" box. Agent-side, dry-run mode mocks all writes.
- **Per-script timeout enforced agent-side.** Default 60s; max 30 min.
  Long-running tasks use a different "scheduled job" facility, not the
  one-shot script runner.

### 7. Software deployment + patch rollout (Phase 3+)

- **Canary → wave → full rollout** semantics with halt-on-failure.
  Cancel button is server-side authoritative — agents poll for
  cancellation between phases.
- **Rollback artifact** retained for 30 days for every install (the
  pre-install package version, captured before the install).
- **No silent installs of new agents.** Adding a new tool to a fleet
  is a deliberate per-tenant decision with audit trail.

### 8. Network minimization

- Agent connects **outbound only** (WSS to OpsHub gateway). No inbound
  ports opened on client networks.
- mTLS at the WSS layer in addition to the per-message HMAC. Client
  cert pinned in the agent build; rotation via signed config update.
- Default-deny on the gateway: an agent with no recent heartbeat is
  refused new commands.

---

## Operational constraints (still on the engineering side)

### Backups

- Postgres backed up nightly; `audit_log` table backed up immutably
  (write-once S3 bucket with object-lock for 6 years).
- Restore drill quarterly — verify hash-chain still validates after
  restore.

### Incident response readiness

- **Breach notification timer starts when we know.** Audit-log query
  must support "give me every action this tenant's agent took in
  the last 7 days, with hash-chain verification" in under 60 seconds.
- Server keeps connection metadata (which agent connected from which
  IP at what time) separate from PHI-bearing data, so forensic
  questions ("did this compromised IP touch any client?") can be
  answered without reading PHI.

### Code-side hygiene (CI required before merge)

- Static analysis on every PR: Semgrep with the `r/security-audit` +
  `r/hipaa` rule packs.
- Dependency scanning: Dependabot + `npm audit --audit-level=high`
  fails the build.
- Secret scanning: gitleaks pre-receive hook on the GitHub repo.
- All commits signed (GPG / sigstore).

---

## What this doesn't get us

This is the engineering side. It's necessary, not sufficient. Still
required outside this repo:

1. **BAA** with each healthcare client (template via legal counsel;
   Microsoft's public BAA is a fine starting model).
2. **Security Risk Assessment** annual — HHS publishes a free SRA
   Tool that walks through it.
3. **Workforce training** on PHI handling for every PCC2K staff
   member with FleetHub access.
4. **Independent pentest** before the first PHI-handling client goes
   live ($5–15k, one-time).
5. **Documented policies**: incident response, contingency, breach
   notification, access management, sanction policy. These ARE the
   "verification" auditors and clients ask for.

---

## Versioning of this doc

This doc is the constitutional spec for FleetHub + PCC2K-Agent design.
Any constraint here that gets relaxed in implementation requires a
corresponding update to this doc, signed off by Mike, before the
relaxation can ship. The doc is checked into the repo so the audit
trail of the spec itself is visible alongside the code.
