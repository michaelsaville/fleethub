# FleetHub

PCC2K's homegrown RMM (Remote Monitoring and Management) — per-host,
per-fleet operations across every client we manage.

**Status:** Design phase, no code yet (2026-04-28). Sister project to
[OpsHub](https://github.com/michaelsaville/opshub); shares the
PCC2K-Agent (designed in OpsHub Phase 2).

## Why "alongside OpsHub" instead of one app?

OpsHub is the **per-user, per-tenant** console — what the help desk does
when a ticket comes in. "Reset Sarah's password." "Wipe Jeff's MFA."
"Show me her sign-in log." Different cognitive context, different
audience, different urgency than fleet operations.

FleetHub is the **per-host, per-fleet** console — what the field tech
does when planning capacity, rolling out patches, or auditing endpoints.
"Push KB5036893 to the 47 Windows 11 hosts at this client." "Show me
every machine running an EOL OS." "Run this PowerShell on the print
server fleet."

The two share **one agent** (the PCC2K-Agent — same binary, two method
namespaces). Two agents fighting for the same Windows host is a
maintenance nightmare; we won't.

## Scope ("never-pay-for-RMM" play)

Full RMM surface, intentionally including the chunky bits:

- **Fleet inventory** — hardware (CPU/RAM/disk/age), software (installed
  apps + versions), OS state (build, patch level, EOL flags), per-host
  health trends
- **Patch management** — Windows Updates orchestration with test rings,
  deferral windows, rollback, third-party catalog (Chocolatey / winget),
  compliance reporting per ring
- **Software deployment** — install / uninstall / update on selected
  hosts with safe-rollout semantics (canary → wave → full)
- **Script orchestration** — run-once or scheduled PowerShell / bash on
  hosts or host groups, with output capture, timeout, dry-run, and
  signed-script-only enforcement for HIPAA tenants
- **Compliance reporting** — patch-level coverage, encryption status,
  password policy adherence, EDR coverage, ready for client review
- **Performance monitoring** — CPU/RAM/disk utilization trends + alerts
- **Asset lifecycle** — purchase date, warranty expiry, replacement
  schedule (ties into DocHub's existing lifecycle runbooks)

Effort ballpark per the OpsHub plan revision: **~9–12 months total**
(OpsHub + FleetHub combined), with patch management alone being 2–3 months.

## HIPAA-ready by construction

Many clients run clinical workstations or handle PHI via M365. FleetHub
is in scope for HIPAA the moment it touches a covered entity's network,
so the design assumes HIPAA from day one. Full design constraints in
[docs/HIPAA-READY.md](docs/HIPAA-READY.md).

Headlines:
- All transport TLS 1.2+
- Audit log is append-only, hash-chained, retained 6+ years
- Code-signed agent binary (Windows Authenticode EV cert)
- No PHI ever in the agent's local cache, in logs, or in screenshots
- Per-client RBAC scoping enforced server-side on every command
- Session recording (RDP/VNC) opt-in per client + encrypted at rest

## Architecture (planned)

```
┌────────────────────┐     ┌────────────────────┐
│      OpsHub        │     │     FleetHub       │
│ identity / tenant  │     │  fleet / per-host  │
│  per-user actions  │     │     operations     │
└─────────┬──────────┘     └──────────┬─────────┘
          │                           │
          │     signed BFFs           │
          └─────────────┬─────────────┘
                        │
                  ┌─────┴─────┐
                  │  Postgres │  shared dochub instance,
                  │ (own schema) │  fleethub schema
                  └─────┬─────┘
                        │
                  ┌─────┴─────┐
                  │  WSS gateway │  shared by OpsHub + FleetHub
                  └─────┬─────┘
                        │
              ┌─────────┴──────────┐
              │   PCC2K-Agent      │  one binary, two method
              │ (Windows / Linux /  │  namespaces:
              │   macOS — Go)       │   ad.*, windows.*  → OpsHub
              │                     │   patches.*, inventory.*,
              │                     │     scripts.*, software.*
              │                     │       → FleetHub
              └─────────────────────┘
```

The agent is the load-bearing component. It will live in its own
repository (`pcc2k-agent`) — Go source, cross-compiled binaries,
code-signed Windows MSI. Both OpsHub and FleetHub talk to it through
the shared WSS gateway.

## Phases (incremental, each shippable)

| Phase | Effort | Goal |
|-------|--------|------|
| 0 — Repo + design freeze | 1 week | this repo, the HIPAA punchlist, the WSS protocol spec |
| 1 — Inventory v1 | 4–5 weeks | agent reports hardware/software, FleetHub UI shows it, drill-down per host |
| 2 — Script orchestration | 4–5 weeks | run-once + scheduled, audit-logged, dry-run, signed-script enforcement |
| 3 — Software deployment | 4–6 weeks | winget + chocolatey, canary/wave rollout, rollback |
| 4 — Patch management | 8–10 weeks | the chunky one. Windows Updates with rings, deferral, third-party catalog |
| 5 — Performance + compliance reports | 3–4 weeks | trends, exports, client-ready PDFs |

## Pre-build punchlist

Before any code lands here, two design docs need to be locked:

1. [docs/HIPAA-READY.md](docs/HIPAA-READY.md) — security/compliance constraints
2. `docs/AGENT-PROTOCOL.md` — the WSS + JSON-RPC schema, signing,
   replay protection, capability discovery (TBD — drafted alongside
   OpsHub Phase 2's agent design, which lands first)

## Sister apps

FleetHub is part of the PCC2K `*Hub` family (open source):

- [DocHub](https://github.com/michaelsaville/dochub) — MSP doc platform
- [TicketHub](https://github.com/michaelsaville/tickethub) — ticketing,
  billing, invoicing
- [BizHub](https://github.com/michaelsaville/bizhub) — RFP/grant scanning
- [Portal](https://github.com/michaelsaville/portal) — client-facing
- [OpsHub](https://github.com/michaelsaville/opshub) — sister project,
  per-user/tenant identity admin
