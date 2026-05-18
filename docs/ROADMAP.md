# FleetHub Roadmap — Cap at Phase 13

**Status:** 2026-05-18. Project will conclude at Phase 13. Phase 0–11 shipped.

The phase-by-phase audit→design→build pattern has worked but had no
explicit endpoint. This doc commits to two more phases (12 + 13)
that consume the remaining deferred backlog, and names what
explicitly does NOT ship — those items become Phase 14+ ideas or
intentional non-goals.

## Shipped (Phases 0–11)

| Phase | What |
|---|---|
| 0 | Setup + auth |
| 1 | Agent enrollment + audit chain |
| 2 | Signed packages + scripts |
| 3 | Patch dispatch + maintenance mode |
| 4 | KEV pull + reporting kinds |
| 5 | Report scheduling + branding + HIPAA soak |
| 6 | MSP triage dashboard |
| 7 | Alerting + escalation + RustDesk + portal join |
| 8 | Monitors + posture + design-system + Cmd-K |
| 9 | Action loops + hardening + agent surface FH-side |
| 10 | Phase 9 loop-closure + notes + MFA login gate |
| 11 | Crypto bundle (vault + WebAuthn + 4-eyes) |

## Phase 12 — Operations expansion

Picks up the high-value operator-facing items that don't share the
crypto theme but DO share a coherent "expand what FleetHub can
monitor and act on" framing.

**Scope:**
- Network device monitoring (SNMP v3 + ICMP) — `Fl_NetworkDevice` + probe pipeline
- Recurring tenant maintenance windows — `Fl_MaintenanceWindow` + cron + alert suppression
- Mutable AV/EDR management — Defender + CrowdStrike scope only
- Vault-KEK rotation UI — `/admin/crypto/rotate` page
- pcc2k-agent Go verbs (shell.open/close, file.push/pull, backup.trigger/cancel) — closes Phase 10 deferral
- xterm.js modal terminal UI on /devices/[id]?tab=remote
- Asset/warranty input UI + "Warranty expiring 90d" report kind
- Saved views on /alerts + /devices
- Alerts bulk-ack Undo toast + Deployments BulkBar — finishes Phase 10 deferral
- Alert evaluator queue throttling
- On-call DST-aware semantics

## Phase 13 — Final polish + project close

Final phase. Anything that doesn't ship here is **explicitly Phase
14+ ideas, not deferred work** — see "Out of scope at project
close" below.

**Scope:**
- Content-recording shell sessions — `Fl_ShellSession.recordingS3Url` + asciicast v2
- Process/service inspector — assumes AGENT-PROTOCOL `fleet.services.*` namespace lands
- Time-tracking on `Fl_RemoteSession` + `Fl_ScriptRun` → TicketHub time-card sync
- Custom monitor expressions — `Fl_Monitor.expressionJson` MVP
- Risk-weight tuning UI on /msp
- 7-day sparkline per signal on triage table
- SSE rail cards + tripped-runbook rail card
- Mobile responsive MSP table
- Per-tenant compliance weight override
- Portal Tailwind→CSS-var bridge (portal-side phase)
- PSA-out adapters — basic ConnectWise only
- `docs/RUNBOOK.md` + `docs/RELEASE-NOTES-v1.0.md` (project-close docs)

## Out of scope at project close

Phase 13's wrap memo will declare these as **intentional non-goals**,
not "deferred". If they become important they become Phase 14+ —
which means a new design pass, not a backlog item.

- HSM / KMS integration (single-server deploy is the model)
- Multi-region key replication
- CMDB / device-depends-on-device graph
- AI alert correlation / root-cause clustering
- White-label / multi-MSP federation
- PWA-native mobile (responsive web is the answer)
- Halo + Autotask PSA adapters (ConnectWise covers the demand)

## Why cap at 13

Six reasons:

1. **The crypto primitive landed in Phase 11.** Phase 12+13 can build
   features on it without re-doing key management.
2. **The Phase 10+11 architect gut-checks pulled SNMP / content-recording
   / process-inspector / AV-mutable / maintenance-windows forward.**
   That's 5 of Phase 12's 11 items already designed-in-prep.
3. **The deferred operator-facing backlog (Phase 10 v1.5, Phase 9 v1.5)
   is finite.** Listing it makes "we're close to done" provable.
4. **Phase 13's wrap memo is the project's "what we built and what we
   left" closing artifact** — operator-readable, not just internal.
5. **Open-ended phase counts breed scope drift.** A named endpoint
   forces "is this Phase 13-or-Phase 14?" decisions.
6. **HSM / KMS / multi-region / AI correlation are full standalone
   projects, not phases.** Declaring them out scope is honest.

## Sequence

```
Phase 12 design  → Phase 12 build  → Phase 12 live memory
Phase 13 design  → Phase 13 build  → Phase 13 live memory + project close
```

Each phase still follows the 4-parallel-audits + architect-gut-check
+ design-doc-commit pattern that's worked since Phase 8. Phase 13's
architect gut-check has one extra question: "is the project actually
done?"
