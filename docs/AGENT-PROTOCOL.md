# PCC2K-Agent ↔ Console protocol

The wire spec for the WSS connection between the **PCC2K-Agent** (the
single Go binary that runs on every managed host) and the shared
**console gateway** that fronts both OpsHub and FleetHub.

Sibling doc to [HIPAA-READY.md](HIPAA-READY.md) (engineering security
constraints) and [UI-PATTERNS.md](UI-PATTERNS.md) (UX constraints). This
doc is the constitutional spec for the wire format. Any implementation
deviation requires this doc updated first.

The agent itself lives in a separate repo (`pcc2k-agent`, not yet
created). Both OpsHub and FleetHub depend on this protocol; both should
import a generated client from the agent repo rather than re-implementing
the envelope.

---

## 1. Scope

In scope here:

- Transport (TLS, mTLS, WSS framing)
- Session establishment (enrollment proof, key derivation)
- Message envelope (JSON-RPC 2.0 + PCC2K extensions)
- Per-message authentication (HMAC, nonce, timestamp)
- Method namespace ownership (which app drives which verbs)
- Capability discovery
- Command/event direction, streaming, cancellation
- Idempotency + reconnect/replay rules
- Signed-script enforcement protocol bits
- Error model

Explicitly **not** in scope here (covered elsewhere or out-of-band):

- Agent installer / MSI signing — pcc2k-agent repo
- Local cache encryption — HIPAA-READY §1
- Audit-log schema + hash chain — HIPAA-READY §2, fl_audit_log
- Per-tenant RBAC scoping — HIPAA-READY §3
- The actual command semantics (what `inventory.collect` *does* on a
  Windows host) — pcc2k-agent repo's per-namespace docs

If any of those leak into this doc, factor them out.

---

## 2. Transport stack (locked)

```
┌──────────────────────────────────────────────────────┐
│ JSON-RPC 2.0 envelope + PCC2K extensions             │  app layer
├──────────────────────────────────────────────────────┤
│ HMAC-SHA-256 over canonical bytes  +  nonce  +  ts   │  msg auth
├──────────────────────────────────────────────────────┤
│ WebSocket (RFC 6455), text frames, no compression    │  framing
├──────────────────────────────────────────────────────┤
│ TLS 1.3 (1.2 minimum), mTLS,  Server SNI required    │  transport
├──────────────────────────────────────────────────────┤
│ TCP/443 outbound from agent only                     │  network
└──────────────────────────────────────────────────────┘
```

**Why every layer:**

| Layer | Purpose | What it stops |
|-------|---------|---------------|
| TLS | confidentiality + server identity | passive tap, MITM with stolen DNS |
| mTLS | client identity at transport | rogue agent connecting with stolen URL |
| WebSocket | bidirectional framing | polling overhead, head-of-line blocking |
| HMAC | per-message integrity + binding | replayed/forged frames if TLS terminator is hostile |
| nonce + ts | replay protection | replay of legitimate captured frames |
| JSON-RPC | structured RPC semantics | ad-hoc envelope drift across versions |

mTLS **and** HMAC are both required, not either-or. mTLS protects the
channel; HMAC binds individual frames to the authenticated session and
to the agent's enrollment secret (so a TLS terminator that re-encrypts
cannot silently inject frames).

WebSocket compression (`permessage-deflate`) is **disabled**. Compression
oracles (CRIME-class) are unlikely on JSON-RPC but the cost of disabling
is negligible.

---

## 3. URL + connection

Agent connects to a single endpoint:

```
wss://gateway.pcc2k.com/agent/v1
```

- One gateway hostname for all clients. Tenancy is established by the
  enrollment proof, not the URL.
- Path version (`/v1`) is the **major** protocol version. Breaking
  changes bump to `/v2`; new gateway speaks both during transition.
- HTTP→HTTPS redirect is **not** permitted on the gateway. Agent fails
  closed if it ever sees an HTTP response.
- Agent presents its client certificate at the TLS handshake (mTLS).
  Gateway pins the issuing CA (PCC2K-internal root) and rejects any
  other issuer.

### Outbound-only

The agent is the **sole initiator**. No inbound port is opened on the
client network. If the agent is offline (gateway down, network down,
agent crashed), commands queue server-side and are delivered on the next
connect.

This is non-negotiable — see HIPAA-READY §8 (network minimization).

---

## 4. Identity + enrollment

### 4.1 Agent identity = `Op_Agent.id`

The agent's identity is owned by **OpsHub** (`opshub.op_agents`).
FleetHub references agents by `Op_Agent.id` via `Fl_Device.agentId`
(nullable until enrollment completes). FleetHub does **not** mint agent
identities and never writes to `op_agents`.

### 4.2 Enrollment-time secret

At enrollment a staff admin generates a one-time bearer token via
OpsHub `/agents/new`. The token is shown **once** and never persisted
plaintext server-side. OpsHub computes two derivatives and stores both:

- `Op_Agent.secretHash` — `PBKDF2-HMAC-SHA256(token, salt, 600_000, 32)`,
  for offline brute-force resistance.
- `Op_Agent.proofKeyEnc` — `HMAC-SHA256(token, "pcc2k.proof.v1")` then
  AES-256-GCM-wrapped under the gateway master key, for online session
  establishment.

Today's `Op_Agent` schema has `secretHash` but **not** `proofKeyEnc` —
adding the column is a tracked dependency on the OpsHub side before
this protocol can ship. Phase 0 of the agent build can use a transient
in-memory map until the column lands. See §5.2 for how both derivatives
are used.

The agent installer takes the token at install time and writes it to
the agent's encrypted local cache. The token is the long-lived shared
secret; everything else (proof key, session keys, HMAC keys) is
derived from it. The agent **never** writes the token to plaintext
disk; the local cache uses AES-256-GCM with a key derived from the
machine GUID + the install-time entropy (HIPAA-READY §1).

If the token is suspected compromised, an admin marks the
`Op_Agent.isActive = false` row and re-issues a fresh token. The agent
must be re-enrolled — old token cannot be reused even if the row is
re-activated, because the salt + proofKey rotate on re-issue.

### 4.3 Client certificate (mTLS)

Separate from the bearer token. Issued by PCC2K-internal CA at
enrollment, embedded in the MSI, valid 1 year, rotated by signed
config update over the agent channel itself once the agent is online.

CN format: `agent.<cuid>.pcc2k.local` where `<cuid>` matches
`Op_Agent.id`. Gateway uses the CN to look up the row before any
JSON-RPC frames flow.

---

## 5. Session lifecycle

### 5.1 Handshake (first 3 messages, in order)

```
1.  agent → server   agent.hello       (declares identity + capabilities)
2.  server → agent   session.challenge (random 32-byte nonce_s)
3.  agent → server   session.proof     (HMAC + nonce_a)
    ── server validates, derives session keys, accepts ──
4.  server → agent   session.accept    (server's view of capabilities)
```

Sequence is strict; any deviation closes the connection.

#### `agent.hello`

```json
{
  "jsonrpc": "2.0",
  "id": "h-1",
  "method": "agent.hello",
  "params": {
    "agentId":     "ckxyz...",       // Op_Agent.id
    "version":     "1.4.2",          // agent semver
    "os":          "windows",
    "osVersion":   "10.0.22631",
    "hostname":    "rx-clinical-01",
    "capabilities": [
      "agent",
      "inventory",
      "scripts",
      "patches",
      "windows.services"
    ],
    "protocolMin": "1.0",
    "protocolMax": "1.0"
  }
}
```

This frame is **not** HMAC-signed (no key has been derived yet). mTLS +
the cert CN match to `agentId` is the only authentication so far.

#### `session.challenge`

Server replies with a 32-byte random nonce, base64. Agent verifies the
gateway's TLS cert chain has already passed (it has — handshake
completed) and uses the nonce in step 3.

#### `session.proof`

```json
{
  "jsonrpc": "2.0",
  "id": "h-2",
  "method": "session.proof",
  "params": {
    "nonceA":     "<base64 32 bytes — agent random>",
    "nonceS":     "<base64 — echoed from challenge>",
    "proof":      "<base64 — HMAC-SHA256(proofKey, nonceS||nonceA||agentId)>"
  }
}
```

`proofKey` is derived by the agent from its enrollment token (see
§5.2). The server has `proofKey` encrypted at rest in
`Op_Agent.proofKeyEnc`; it decrypts at session start, recomputes the
HMAC, and compares constant-time. Mismatch → close with `4001
auth_failed`. Match → derive session keys.

#### `session.accept`

Server replies with the negotiated protocol version, the server-known
capability subset, and the server's clock for `ts` skew calibration.

```json
{
  "jsonrpc": "2.0",
  "id": "h-2",
  "result": {
    "protocolVersion": "1.0",
    "serverTime":      "2026-04-30T20:11:14.234Z",
    "acceptedCapabilities": ["agent", "inventory", "scripts"],
    "rejectedCapabilities": ["patches"],   // e.g. agent declared but server has it disabled for tenant
    "heartbeatSec": 30
  }
}
```

After this, all subsequent frames must carry the auth fields (§7). The
handshake frames themselves are also written to `fl_audit_log` and
`op_audit_log` (action=`agent.session.opened`).

### 5.2 Key derivation

The agent's enrollment **token** is the only long-lived secret the
plaintext of which exists anywhere — and only on the agent's encrypted
local cache. The server never sees plaintext after enrollment.

Two derived values come off the token at enrollment time:

```
secretHash = PBKDF2-HMAC-SHA256(token, salt, 600_000, 32 bytes)
proofKey   = HMAC-SHA256(token, "pcc2k.proof.v1")
```

The agent stores the token. The server stores both derivatives:

| column | derivation | purpose |
|---|---|---|
| `op_agents.secretHash` | `PBKDF2(token, salt)` | offline brute-force resistance for stolen DB |
| `op_agents.proofKeyEnc` | `proofKey` AES-256-GCM-wrapped under the gateway master key | online session establishment |

`proofKey` is what's actually used at session time — `secretHash` exists
purely as a defense-in-depth tripwire (an attacker who exfiltrates the
DB still can't impersonate an agent unless they also extract the master
key from the gateway's secret store). The encryption-at-rest on
`proofKeyEnc` is therefore mandatory; without it, DB exfiltration
becomes agent impersonation.

Both sides derive `sessionKey` from `proofKey` plus the two nonces:

```
sessionKey = HKDF-SHA256(
  ikm  = proofKey,
  salt = nonceS || nonceA,
  info = "pcc2k.session.v1|" || agentId,
  L    = 32 bytes
)
```

The server has `proofKey` (decrypted from `proofKeyEnc` at session
start). The agent has `proofKey` (re-derived from `token` on each
session, never persisted on disk). Identical inputs → identical
`sessionKey` on both sides. From here, every non-handshake frame is
HMAC-signed with `sessionKey` (§7).

### 5.3 Heartbeat

Server's `session.accept` returns `heartbeatSec` (default 30). Agent
sends `agent.heartbeat` every interval; gateway updates
`Op_Agent.lastSeenAt` and `Fl_Device.isOnline = true`. Three missed
heartbeats → mark offline, fire `alert.fire kind=agent.disconnected`.

### 5.4 Session close

Either side may close. Close codes (WebSocket close frame):

| code | meaning |
|---|---|
| 1000 | normal (agent shutting down, server restart) |
| 4001 | auth_failed (session.proof mismatch) |
| 4002 | replay_detected |
| 4003 | session_expired (server forced re-handshake) |
| 4004 | agent_revoked (`isActive=false`) |
| 4005 | protocol_violation (malformed frame, missing auth) |
| 4900 | server_overload (try again with backoff) |

Agent reconnect policy: exponential backoff capped at 60s, jittered.
Never tighter than 5s after a 4001/4002/4004 (those require human
intervention; aggressive retry is just noise).

---

## 6. Message envelope

Built on JSON-RPC 2.0 (RFC, batchable, request/response/notification).
PCC2K extensions live in a sibling `auth` field at the same level as
`jsonrpc`/`id`/`method`/`params`.

### 6.1 Request (server → agent or agent → server)

```json
{
  "jsonrpc": "2.0",
  "id":     "ck01h7y...",
  "method": "scripts.execute",
  "params": { "...": "..." },
  "auth": {
    "ts":    "2026-04-30T20:11:15.001Z",
    "nonce": "f3a1...e9",            // 16-byte hex
    "mac":   "<base64 HMAC>"
  }
}
```

`id` is a CUID (not a numeric counter) and serves as the **command id**
across the system. The same id is used in audit logs, in
`Fl_ScriptRun`, in UI breadcrumbs.

### 6.2 Response

```json
{
  "jsonrpc": "2.0",
  "id":     "ck01h7y...",
  "result": { "...": "..." },
  "auth":   { "ts": "...", "nonce": "...", "mac": "..." }
}
```

Or an error:

```json
{
  "jsonrpc": "2.0",
  "id":     "ck01h7y...",
  "error":  {
    "code":    -32099,
    "message": "agent.busy",
    "data":    { "retryable": true, "retryAfterSec": 5 }
  },
  "auth":   { "...": "..." }
}
```

### 6.3 Notification (no response expected)

JSON-RPC `id` field omitted. Used for streaming output and for events
the receiver cannot meaningfully reply to (`alert.fire`,
`script.output` chunks).

### 6.4 Batch

Permitted but discouraged. Gateway accepts JSON arrays per JSON-RPC 2.0;
HMAC covers each element individually (the array wrapping is not part
of the canonical bytes). Streaming batches across frame boundaries is
not supported.

---

## 7. Per-message authentication

### 7.1 Canonical bytes

`mac` is computed over:

```
canonical =
  utf8(method)              ||
  0x00                      ||
  utf8(id_or_empty_string)  ||
  0x00                      ||
  utf8(ts)                  ||
  0x00                      ||
  utf8(nonce)               ||
  0x00                      ||
  sha256(canonical_json(params_or_result_or_error))
```

`canonical_json` is a stable serialization (sorted keys, no whitespace,
RFC 8785 JCS). Implementations import the same canonicalizer from a
shared package — do not roll your own.

```
mac = base64( HMAC-SHA-256(sessionKey, canonical) )
```

### 7.2 Replay protection

- `ts` must be within ±300 seconds of server clock (calibrated via
  `session.accept.serverTime`).
- `nonce` is rejected if seen within the last 600 seconds for the
  current session.

Server tracks nonces in a session-scoped LRU (Redis or local). A new
session means a fresh nonce window — replaying frames from a closed
session is automatically blocked because the session key is gone.

Failure to validate either field → close with `4002 replay_detected`.
This is louder than necessary but the right default; clients with bad
clocks need to be told.

### 7.3 What auth covers

- The method, id, ts, nonce, and a hash of the payload — so swapping
  payload content while keeping the envelope reuses an old MAC and
  fails.
- It does **not** cover the `auth` object itself (chicken-and-egg).
- It does **not** cover WebSocket framing — that's TLS's job.

---

## 8. Method namespace ownership

Single shared agent, two consoles, one rule: **one namespace = one
console**. No method is shared across consoles. Agents declare every
namespace they support via `agent.hello.capabilities`.

| Namespace | Owner | Direction | Phase | Sample methods |
|---|---|---|---|---|
| `agent.*` | shared (meta) | both | 0 | `agent.hello`, `agent.heartbeat`, `agent.config.fetch` |
| `session.*` | shared (handshake) | both | 0 | `session.challenge`, `session.proof`, `session.accept` |
| `commands.*` | shared (scheduling) | both | 0 | `commands.poll`, `commands.ack`, `commands.cancel` |
| `ad.*` | OpsHub | server→agent | OpsHub Phase 2 | `ad.password.reset`, `ad.user.lookup`, `ad.user.unlock` |
| `windows.services.*` | OpsHub | server→agent | OpsHub Phase 2 | `windows.services.list`, `windows.services.restart` |
| `inventory.*` | FleetHub | both | FleetHub Phase 1 | `inventory.collect`, `inventory.delta`, `inventory.report` |
| `patches.*` | FleetHub | server→agent | FleetHub Phase 4 | `patches.list`, `patches.deploy`, `patches.history` |
| `scripts.*` | FleetHub | server→agent | FleetHub Phase 2 | `scripts.execute` (+ `script.output` notif) |
| `software.*` | FleetHub | server→agent | FleetHub Phase 3 | `software.install`, `software.uninstall`, `software.list` |
| `alert.*` | FleetHub (ingress) | agent→server | FleetHub Phase 1 | `alert.fire` |
| `monitor.*` | OpsHub | both | OpsHub Phase 3 | `monitor.probe.run`, `monitor.report` |

**Reserving a new namespace:** add a row here, get sign-off from the
non-owning console's lead, then implement. Do not squat on namespaces.

**Capability declaration vs server enablement:** an agent declares
every namespace it has the *code* for. The server may reject a subset
(see `session.accept.rejectedCapabilities`) for tenant policy reasons
— e.g. a healthcare client has `scripts` disabled until the
signed-script registry is configured.

---

## 9. Capability discovery

Capabilities are dotted-namespace strings, optionally with a `:vN`
version suffix:

- `inventory` — base namespace
- `inventory:v2` — v2 of inventory commands (additive fields, new
  sub-methods)

UI greys out actions the agent didn't declare. Server enforces a
capability check before queueing any command — agent-side rejection is
defense-in-depth, not the gate.

When new namespaces ship, older agents just don't declare them; gateway
returns `error.method_not_supported` if an operator somehow queues an
unsupported command (shouldn't happen — UI wouldn't render the
button).

---

## 10. Direction + queueing

### 10.1 Server-initiated commands

Server sends a request frame. Agent processes synchronously by default
and replies with `result` / `error`. For long-running commands the
agent immediately returns `result: { state: "queued", commandId: ... }`
and emits notifications (`script.output`, etc.) plus a final
`commands.ack` event when done.

### 10.2 Agent-initiated events

The agent pushes events when state changes or on a schedule:

- `agent.heartbeat` (every `heartbeatSec`)
- `inventory.report` (push on schedule + on detected delta)
- `alert.fire` (when local check transitions to fail)
- `script.output` (streaming chunks during a running script)

### 10.3 Disconnected operation

If the agent is offline:

- **Server-initiated commands** queue in `op_command_queue` (OpsHub
  schema, separate doc — table not yet created). On reconnect the
  server drains via `commands.poll`. Default queue TTL = 24h; expired
  commands marked `error: queue_expired`.
- **Agent-initiated events** queue in the agent's encrypted local
  cache (HIPAA-READY §1). On reconnect the agent drains in order. The
  server idempotency-keys events by `(agentId, eventId)` and dedupes.

### 10.4 Idempotency

Every command has a CUID `id`. Re-receiving the same `id` in the same
session is a replay (rejected via §7.2 nonce). Re-receiving across
sessions (e.g. server retry after network blip) is **expected** and
must produce the same result — agent stores last 1000 command results
in encrypted cache and short-circuits on duplicate `id`.

Events are also CUID-keyed; server-side `(agentId, eventId)` is a
unique index.

---

## 11. Streaming long output

Long-running commands emit notifications during execution:

```json
// notification — no id, agent → server
{
  "jsonrpc": "2.0",
  "method":  "script.output",
  "params": {
    "commandId": "<original request id>",
    "seq":       3,
    "stream":    "stdout",
    "chunk":     "PS> Get-Service\\nname  state\\n..."
  },
  "auth": { "...": "..." }
}
```

Final result (`scripts.execute` response) is sent **after** all output
notifications. UI assembles `chunk[seq]` in order; gaps are surfaced as
"output dropped" rather than silently elided.

Per-chunk size capped at 16KB. Total streamed output capped at 64KB —
beyond that, agent uploads to object storage (Phase 3+, separate doc)
and the response includes a presigned URL.

---

## 12. Cancellation

Server is **authoritative**. Operators clicking "Cancel" produces:

```
server → agent   commands.cancel   { commandId: "ck01h7y..." }
```

Agent must:

1. Acknowledge via response within 5s.
2. Stop the in-flight command (kill child process, abort I/O).
3. Emit `commands.ack { commandId, state: "cancelled" }`.

If the agent is mid-script and the OS won't kill the process, the agent
emits `commands.ack { state: "cancel_pending" }` and keeps trying. The
console UI shows "cancelling" until a terminal state.

Long-running commands also poll between phases. The agent calls
`commands.poll { since: <ts> }` every 30s during multi-phase work
(patch rollouts, large inventory scans) and aborts if the queue
contains a cancel for the current id.

---

## 13. Signed-script enforcement (Phase 2)

For HIPAA tenants every `scripts.execute` request includes:

```json
{
  "method": "scripts.execute",
  "params": {
    "scriptId":   "<Fl_Script.id>",
    "body":       "<full script text>",
    "signedHash": "<SHA-256 of body, base16>",
    "signature":  "<base64 ed25519 sig over (signedHash || ts)>",
    "signerKid":  "<key id of signer's pinned public key>",
    "dryRun":     true,
    "timeoutSec": 60,
    "args":       { "...": "..." }
  }
}
```

Agent validation steps before execution:

1. Compute `actualHash = SHA-256(body)`. Compare to `signedHash`.
   Mismatch → reject `error.script_hash_mismatch`.
2. Verify `signature` against the pinned public key matching `signerKid`
   (keys baked into the agent build; rotation via
   `agent.config.fetch`). Invalid → reject `error.script_unsigned`.
3. Verify `ts` (in `auth.ts`) is within 24h of agent's clock — signed
   scripts cannot be replayed forever.
4. If all checks pass, execute.

Tenants without the HIPAA flag may run unsigned scripts (`signature`
omitted), but the audit log records `signed=false` and the UI shows a
warning. **HIPAA tenants** have the agent reject unsigned scripts
unconditionally (config flag delivered via `agent.config.fetch`).

---

## 14. Dry-run defaults

Every state-mutating command has a `dryRun` parameter. Server-side
default is **always `true`** for:

- `scripts.execute`
- `patches.deploy`
- `software.install` / `software.uninstall`
- `ad.password.reset` (OpsHub-side, but listed for completeness)
- `windows.services.restart`

The UI must explicitly set `dryRun: false` and the operator must
explicitly check "really run this". Any command builder helper that
doesn't expose `dryRun` is a bug.

In dry-run mode the agent reports what *would* happen (which packages
would update, which services would restart, what the script would
write) but performs no writes. The response includes
`{ dryRun: true, wouldAffect: [...] }`.

---

## 15. Errors

JSON-RPC error codes:

| code | meaning |
|---|---|
| -32700 | parse error |
| -32600 | invalid request (envelope malformed) |
| -32601 | method not found |
| -32602 | invalid params |
| -32603 | internal error |

PCC2K-specific (range -32000 to -32099):

| code | meaning | retryable |
|---|---|---|
| -32000 | auth.invalid_mac | no |
| -32001 | auth.replay_detected | no |
| -32002 | auth.session_expired | no (re-handshake) |
| -32010 | capability.not_declared | no |
| -32011 | capability.disabled_for_tenant | no |
| -32020 | command.cancelled | no |
| -32021 | command.timeout | yes |
| -32022 | command.queue_expired | no |
| -32030 | script.hash_mismatch | no |
| -32031 | script.unsigned | no |
| -32032 | script.signer_unknown | no |
| -32040 | agent.busy | yes (with retryAfterSec) |
| -32041 | agent.unsupported_os | no |
| -32099 | agent.internal | conditional |

`error.data` always carries:

```json
{ "retryable": true|false, "retryAfterSec": 30, "context": { ... } }
```

Implementations log the full error and surface `message` to the UI.

---

## 16. Versioning + compatibility

- **Major** version (`/v1`, `/v2`) bumps for breaking changes to
  envelope, signing, or auth flow. Both versions are served by the
  gateway during transition (≥6 months overlap target).
- **Minor** version (`protocolVersion: "1.3"`) bumps for additive
  changes — new namespaces, new optional fields. Old agents ignore
  unknown fields; new agents tolerate missing optional fields. New
  `protocolMin/Max` declared in `agent.hello`; gateway picks the
  highest mutually supported version.
- **Method-level** versioning lives in capabilities (`inventory:v2`)
  rather than version numbers in the envelope — keeps namespace
  evolution local.

Once shipped, **method semantics are immutable**. New behavior = new
method (e.g. `inventory.collect.v2`). Renames are bans.

---

## 17. Audit + observability

Every privileged action through the protocol produces an audit row in
the owning console's audit table:

- OpsHub-owned methods → `op_audit_log`
- FleetHub-owned methods → `fl_audit_log`
- `agent.*` and `session.*` → both consoles' tables get a row, since
  both consoles' UIs surface session activity

Hash chain per HIPAA-READY §2; verification endpoint already shipped
(`GET /api/audit/verify`).

Connection metadata (source IP, TLS version, session id, client cert
fingerprint) is logged separately into a non-PHI table for forensic
queries (HIPAA-READY operational §incident-response). Schema for that
table is a separate Phase 1 deploy task.

Gateway exposes Prometheus metrics on a private port:

- `pcc2k_agent_sessions_active{client}`
- `pcc2k_agent_messages_total{method,outcome}`
- `pcc2k_agent_handshake_duration_seconds`
- `pcc2k_agent_replay_rejects_total` (alert if non-zero)

---

## 18. Implementation order

Builds top-down — earlier items are prerequisites:

1. **Gateway WSS endpoint** with TLS + mTLS, no auth above transport
   yet. Just accept connections, log cert CN, close. (~1 wk)
2. **Handshake + session keys.** `agent.hello` → `session.challenge` →
   `session.proof` → `session.accept`. No real methods yet. (~1 wk)
3. **HMAC + replay-window.** All non-handshake frames carry auth.
   Tested with a synthetic agent. (~1 wk)
4. **`commands.poll` / `commands.ack` + reconnect/replay queue.** No
   actual method handlers yet; just the queue. (~1 wk)
5. **First real namespace: `inventory.*`** (FleetHub Phase 1 starts
   here). (~4–5 wks for namespace + agent-side collectors + UI wiring,
   matching the README's Phase 1 estimate)
6. **`scripts.*` with signed-script enforcement** (FleetHub Phase 2).
7. **`ad.*`, `windows.services.*`** (OpsHub Phase 2 — parallel to
   FleetHub Phase 2/3).
8. **`patches.*`, `software.*`** (FleetHub Phase 3-4).

Items 1–4 are agent-repo + gateway work; FleetHub side is consumer
only. Items 5+ have FleetHub UI work tracked in the FleetHub repo's
phase plan.

---

## 19. Open questions (track + resolve before agent code lands)

These are deliberately punted but flagged to be answered before agent
code is written:

- **Gateway placement.** Today the only public-facing PCC2K nginx is
  100.91.194.83. Does the agent gateway live on the same nginx (new
  vhost `gateway.pcc2k.com`) or on a dedicated host? mTLS termination
  vs pass-through is the deciding factor — leaning toward pass-through
  on a dedicated host so cert pinning is enforced at the app, not nginx.
- **Object storage for large outputs.** Likely a Backblaze B2 bucket
  with object-lock; need to write the auth + presigned-URL flow before
  Phase 3 ships.
- **Agent self-update channel.** When does the agent pull a new build,
  who signs it, how is rollback handled? Probably its own doc in the
  pcc2k-agent repo, but the gateway must be aware (signed-config
  push).
- **Multi-agent on one host.** OpsHub already had concerns about two
  agents fighting for the same Windows services. We've committed to
  one agent — but: dev/test mode? A side-channel for engineering? Punt
  to YAGNI; revisit if it bites.

---

## 21. `scripts.*` method bodies (Phase 2)

Phase 2 ships three method bodies in the `scripts.*` namespace. Full
semantics in [`PHASE-2-DESIGN.md`](PHASE-2-DESIGN.md); this section is
the wire contract only.

### 21.1 `scripts.exec` (server → agent)

```jsonc
{ "method": "scripts.exec", "params": {
    "commandId":     "<cuid>",
    "scriptId":      "<cuid>",
    "scriptBody":    "<utf-8>",
    "scriptSig":     "<ed25519-b64>",
    "scriptSha256":  "<hex>",
    "interpreter":   "powershell" | "bash" | "cmd",
    "args":          ["..."],
    "env":           { "K": "v" },
    "dryRun":        true,
    "timeoutSec":    300,
    "outputBytesCap": 65536
}}
```

Agent verifies `scriptSha256` (recompute from `scriptBody`), then
verifies `scriptSig` against the locally-cached tenant public-key set
(see §13). Mismatch → reject with `script-sig-invalid` or
`script-body-tampered`. Capability drop per script's
`Fl_Script.capabilitiesJson`.

Response is the standard `result: { state: "queued", commandId }` for
long-running commands per §10.1.

### 21.2 `scripts.output` (agent → server, notification)

```jsonc
{ "method": "scripts.output", "params": {
    "commandId": "<cuid>",
    "stream":    "stdout" | "stderr",
    "seq":       0,
    "data":      "<utf-8 chunk>"
}}
```

≤4 KiB per frame, batched ≤200ms, backpressured per §11.

### 21.3 `scripts.complete` (agent → server, notification)

```jsonc
{ "method": "scripts.complete", "params": {
    "commandId":   "<cuid>",
    "exitCode":    0,
    "durationMs":  4231,
    "outputBytes": 12384,
    "outputUrl":   "s3://...",
    "outputSha256": "<hex>"
}}
```

`outputUrl` null when `outputBytes ≤ outputBytesCap`. Otherwise full
transcript at the URL; agent uploads before sending this frame.

### 21.4 `scripts.cancel` (server → agent)

```jsonc
{ "method": "scripts.cancel", "params": {
    "commandId": "<cuid>",
    "reason":    "operator-cancel" | "timeout" | "client-disconnect"
}}
```

Best-effort: `SIGTERM` → 5s grace → `SIGKILL`. Windows uses
`TerminateJobObject`. Agent still emits a `scripts.complete` frame
with the observed exit code.

---

## 22. `software.*` method bodies (Phase 3)

Phase 3 ships four method bodies in the `software.*` namespace plus
two notifications. Full semantics in
[`PHASE-3-DESIGN.md`](PHASE-3-DESIGN.md).

### 22.1 `software.install` (server → agent)

```jsonc
{ "method": "software.install", "params": {
    "commandId":    "<cuid>",
    "deploymentId": "<cuid>",
    "package": {
      "id":               "<Fl_Package.id>",
      "source":           "winget" | "choco" | "brew" | "custom",
      "sourceId":         "<vendor id>",
      "version":          "<exact server-pinned>",
      "scope":            "machine" | "user",
      "silentInstallArgs": "<string>",
      "artifactUrl":      "https://...",   // custom only
      "artifactSha256":   "<hex>",         // custom only
      "bodyEd25519Sig":   "<b64>"          // when signedBody=true
    },
    "detectionRule": { "kind": "<rule>", ... },
    "rebootPolicy":  "never" | "defer-if-user-active" | "force"
                    | "schedule-window",
    "dryRun":        true,
    "timeoutSec":    1200,
    "outputBytesCap": 65536
}}
```

Agent flow:
1. Run detection. Already at requested version → `software.complete`
   with `result: "no-op"`.
2. Custom source → fetch artifact, verify `artifactSha256` +
   `bodyEd25519Sig` if `signedBody=true`.
3. `dryRun=true` → use source-appropriate dry-run flag (winget
   `--whatif`, brew `--dry-run`, custom MSI `msiexec /a`).
4. Otherwise execute, stream `software.progress`.
5. Re-run detection post-install. `software.complete` reports the
   verified post-install version.

### 22.2 `software.uninstall` (server → agent)

Same envelope as `software.install` with `action="uninstall"`. Agent
uses `Fl_Package.silentUninstallArgs` (or auto-derives for native
package managers). Detection rule fires post-uninstall to confirm
absence.

### 22.3 `software.detect` (server → agent)

```jsonc
{ "method": "software.detect", "params": {
    "commandId": "<cuid>",
    "checks": [
      { "packageId": "<Fl_Package.id>", "rule": { "kind": "...", ... } },
      ...  // batch up to 50
    ]
}}
```

Lightweight (no install, no download). Used for on-demand drift
refresh + post-deploy validation. Returns per-check
`{ packageId, present: bool, detectedVersion?: string }`.

### 22.4 `software.progress` (agent → server, notification)

```jsonc
{ "method": "software.progress", "params": {
    "commandId": "<cuid>",
    "phase":     "downloading" | "extracting" | "installing"
                | "verifying" | "rebooting",
    "percent":   47,
    "message":   "Downloading 12.4 / 26.1 MB",
    "stream":    "stdout" | "stderr",
    "data":      "<utf-8 chunk>",
    "seq":       0
}}
```

Same batching rules as `scripts.output` (§21.2).

### 22.5 `software.complete` (agent → server, notification)

```jsonc
{ "method": "software.complete", "params": {
    "commandId":       "<cuid>",
    "result":          "installed" | "updated" | "no-op"
                      | "failed" | "reboot-required"
                      | "reboot-deferred",
    "exitCode":        0,
    "durationMs":      47213,
    "detectedVersion": "<post-install verify>",
    "rebootPending":   false,
    "stderrTail":      "<last 4 KiB>",   // inline so monitor doesn't drill
    "outputUrl":       "s3://...",
    "outputSha256":    "<hex>"
}}
```

`stderrTail` inline is non-negotiable per the deploy-monitor UX
(PHASE-3-DESIGN §8). The Phase 3 server's
`simulateAgentResponse()` is the swap-out point that becomes this
real callback.

---

## 23. `patches.*` method bodies (Phase 4)

Phase 4 ships five method bodies + three notifications. Full semantics
in [`PHASE-4-DESIGN.md`](PHASE-4-DESIGN.md).

### 23.1 `patches.scan` (server → agent)

```jsonc
{ "method": "patches.scan", "params": {
    "commandId":        "<cuid>",
    "fullRescan":       false,
    "detectionMethods": ["wmi-qfe", "dism-packages", "wu-history"]
}}
```

Agent enumerates installed patches via the named methods (multi-signal
on Windows; single-method elsewhere). Returns counts inline; full
payload via `patches.report` notification (large).

### 23.2 `patches.detect` (server → agent)

```jsonc
{ "method": "patches.detect", "params": {
    "commandId": "<cuid>",
    "checks": [
      { "patchId": "<Fl_Patch.id>", "rule": { "kind": "...", ... } },
      ...  // batch up to 50
    ]
}}
```

Per-check returns:

```jsonc
{ "patchId":   "<id>",
  "methods":   { "wmiQfe": true, "dismPackages": true, "wuHistory": true },
  "consensus": "all-yes" | "all-no" | "disagreement" }
```

The `disagreement` consensus is the alert-worthy "your dashboard is
lying" event (PHASE-4-DESIGN §12).

### 23.3 `patches.deploy` (server → agent)

```jsonc
{ "method": "patches.deploy", "params": {
    "commandId":    "<cuid>",
    "deploymentId": "<cuid>",
    "patch": {
      "id":             "<Fl_Patch.id>",
      "source":         "ms" | "thirdparty" | "custom",
      "sourceId":       "KB5036893" | "Adobe.Acrobat.DC@..." | "custom:<id>",
      "isHotpatch":     true,
      "requiresReboot": false,
      "artifactUrl":    null | "https://...",
      "artifactSha256": null | "<hex>",
      "bodyEd25519Sig": null | "<b64>"
    },
    "preflightGate": {
      "minDiskSpaceGb":            15,
      "maxRamPercent":             90,
      "requireBackupWithinHours":  24,
      "requireNoPendingReboot":    true,
      "requireServiceHealth":      true,
      "respectMaintenanceMode":    true,
      "customPreflightScriptId":   null | "<Fl_Script.id>"
    },
    "rebootPolicy": "never" | "defer-if-user-active" | "force"
                   | "schedule-window",
    "dryRun":       true,
    "timeoutSec":   1800,
    "outputBytesCap": 65536
}}
```

Agent runs pre-flight gate first; failure → `patches.complete` with
`result: "preflight-failed"` and the gate name. Hotpatch
(`isHotpatch=true`) skips the reboot path entirely. Multi-signal
detection re-runs post-install — disagreement becomes
`result: "failed"` with `failureReason: "detection-disagreement"`.

### 23.4 `patches.uninstall` (server → agent — the rollback path)

```jsonc
{ "method": "patches.uninstall", "params": {
    "commandId":  "<cuid>",
    "patchId":    "<Fl_Patch.id>",
    "kbId":       "KB5036893",
    "strategies": ["wusa", "dism-remove-package", "restore-point", "vm-snapshot"],
    "timeoutSec": 1800
}}
```

Agent attempts strategies in order. Per-strategy result:
`success | not-applicable | declined-by-os | failed-with-error`. First
success short-circuits. Final `patches.complete` with
`result: "rolled-back" | "rollback-failed" | "rollback-partial"` +
the strategy that worked.

### 23.5 `patches.advisory.fire` (agent → server, notification)

```jsonc
{ "method": "patches.advisory.fire", "params": {
    "agentId":        "<Op_Agent.id>",
    "kbId":           "KB5036893",
    "publishedAt":    "2026-05-02T...",
    "classification": "critical" | "security" | "rollup" | "feature"
                     | "definition" | "driver"
}}
```

Agent's local Windows Update API surfaces a patch the server catalog
hasn't ingested yet. Treated as a hint — next ingest cron picks it up
regardless, but advisory.fire reduces "minutes vs days" lag for the
first host to see it.

### 23.6 `patches.progress` + `patches.complete` (agent → server)

Same envelope as `software.progress` + `software.complete` (§22.4 +
§22.5) with these additions to `patches.complete`:

```jsonc
{
  "result":         "installed" | "no-op" | "failed"
                   | "preflight-failed" | "reboot-required"
                   | "reboot-deferred" | "rolled-back"
                   | "rollback-failed" | "rollback-partial"
                   | "detection-disagreement",
  "preflightGateFailed":  null | "<gate name>",
  "detectionConsensus":   "all-yes" | "all-no" | "disagreement",
  "perMethodDetection":   { "wmiQfe": bool, "dismPackages": bool, "wuHistory": bool },
  "rollbackStrategyUsed": null | "wusa" | "dism-remove-package"
                              | "restore-point" | "vm-snapshot"
}
```

---

## 24. Phase 5 reports — no agent namespace

Phase 5 (Performance + Compliance Reports) is server-side render. The
agent-side data needed for reports flows through namespaces that
already exist:

- Performance time-series: agent's existing `inventory.report` push
  (per §10.2) feeds `Fl_PerformanceSample` via a server-side hourly
  rollup cron.
- Patch posture: `Fl_PatchInstall` populated by `patches.scan` /
  `patches.detect` (§23.1, §23.2).
- Software inventory: `Fl_Package` + `Fl_DeploymentTarget` populated
  by Phase 3 + Phase 1 inventory.
- Audit chain: `Fl_AuditLog`, written server-side per HIPAA-READY §2.

So **no `reports.*` namespace exists** by design. Reports are pure
read-aggregation + PDF render server-side. The §8 namespace ownership
table reflects this (only `inventory.*`, `scripts.*`, `software.*`,
`patches.*`, `alert.*` are FleetHub-owned).

---

## 20. Versioning of this doc

This doc is the **wire contract**. Any implementation deviation
requires:

1. PR to this doc explaining the deviation, marked with a `// LOCK
   v1.x` annotation in the affected section.
2. Sign-off from the owners of both consoles (OpsHub + FleetHub) plus
   the agent repo lead.
3. Bump to `protocolVersion` if the wire format changed.

The doc is checked into the FleetHub repo (where the design phase is
hottest as of this writing) but **belongs to all three repos**. Once
the agent repo exists, this file moves there and FleetHub/OpsHub
import via git submodule or vendored copy. Until then, any change
here triggers a sync notice to the OpsHub maintainer.
