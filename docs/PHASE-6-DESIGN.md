# FleetHub Phase 6 — Cross-tenant MSP Dashboard (Design)

**Status:** Draft, 2026-05-15. Not yet implemented. Phase 6 is gated on Phases 1–5 having shipped their data shapes — the dashboard aggregates `Fl_Device` / `Fl_Alert` / `Fl_PatchInstall` / `Fl_ScriptRun` / `Fl_Report` / `Fl_AuditLog` and so depends on every prior phase being live.

**Scope of this doc:** the design contract for a single-screen, all-clients-at-once view that lets one operator triage the entire managed fleet in under 30 seconds. Permission model, risk scoring, drill-down behavior, refresh cadence, and the v1/v1.5 split. Like the prior phase docs: the spec IS the contract.

**Cross-references:**
- [`PHASE-1-DESIGN.md`](PHASE-1-DESIGN.md) — `Fl_Device` is the per-host snapshot the dashboard rolls up
- [`PHASE-2-DESIGN.md`](PHASE-2-DESIGN.md) — `Fl_ScriptRun.state` feeds the "scripts failing" column
- [`PHASE-3-DESIGN.md`](PHASE-3-DESIGN.md) — `Fl_DeploymentTarget.state` feeds the "deploys stuck" column
- [`PHASE-4-DESIGN.md`](PHASE-4-DESIGN.md) — `Fl_PatchInstall` + KEV catalog feed the "patch posture" columns
- [`PHASE-5-DESIGN.md`](PHASE-5-DESIGN.md) §2 — Phase 5's pain table called out this MSP rollup gap; Phase 5 only solved it for *reports*. Phase 6 makes it interactive.
- [`HIPAA-READY.md`](HIPAA-READY.md) §3 — per-user client scope is enforced; the dashboard MUST honor it.
- [`UI-PATTERNS.md`](UI-PATTERNS.md) — hyperlink-every-number, Cmd-K, no-buried-config

---

## 1. What Phase 6 ships

Concretely, by the end of Phase 6:

- A tech opens FleetHub and one click into the sidebar (`Triage`) lands on one screen with one row per managed client, sorted by *how much pain that client is in right now*. Open critical alerts, offline hosts, hosts behind on patches, stuck deploys, failing scripts, audit-chain health, schedule freshness — all in line, no clicking.
- A "Needs your attention" rail at the top surfaces the top ~6 most-acute signals across the entire fleet (the single oldest open critical alert, the host with the most KEV CVEs unpatched, the schedule that hasn't fired in 36h, etc.). Each rail item is a deep link to the exact screen that fixes it.
- The current single-fleet home dashboard (`app/(protected)/page.tsx`) is **unchanged**. The triage view lives at `/msp` and is reached via the sidebar — operators with existing muscle memory for `/` keep their home, and the MSP rollup is purely additive. Single-client operators (the small-MSP / homelab case) can skip `/msp` entirely; the home dashboard already answers their question.
- Every number in every cell is a hyperlink to the existing client-scoped page with the correct tab pre-selected. No new detail screens.
- Sort by composite risk score (default) OR by any column. Filter to show only clients matching a signal class ("show me only clients with offline hosts", "only critical alerts", "only patch-behind"). Filter state persists in URL query params so a triage URL can be Slack'd to a teammate.
- Per-tenant rows honor the operator's `fleet_staff_client_scope` — a junior tech who can't see Acme Health doesn't see Acme Health here either.
- Optional TicketHub overlay column: a count of open tickets per client, pulled via the same cross-schema `$queryRaw` pattern Phase 5.13's pre-create form uses. Hides cleanly when TicketHub isn't present.
- Cmd-K commands: `triage`, `triage critical`, `triage offline`, `triage <client-name>` (jump straight to that row).

## 2. The pain points this design is built around

| Decision | Counters this RMM failure |
|---|---|
| One screen, all clients, one row each | Automox / Datto / Connectwise force per-tenant view-switching; the MSP burns 10 minutes clicking through 12 clients every morning to see who's on fire |
| Default sort = composite risk score, not alphabetical | Alphabetical sort buries the burning client at row 7; the operator scans top-to-bottom and Acme always wins. Tickets pile up at clients in the bottom half of the alphabet. |
| "Needs your attention" rail above the table | Total-count metrics ("47 open alerts") tell you the wave size, not where to start. The rail names the *specific* row to click first. |
| Every cell is a hyperlink, not a tooltip | Datto's hovering modal-on-hover pattern is unusable on iPad and burns 200ms before the operator can act. Direct link = no fluff. |
| Schedule health column ("last fired 14m ago" vs "last fired 36h ago — STALE") | Datto + ConnectWise hide cron failures three menus deep; a backup-monitoring schedule that quietly died for 4 weeks is the classic auditor catch. Surface it on the front page. |
| Audit-chain integrity column | Phase 5 step 11 evidence-zip smoke caught a real chain break at row 4 / 2026-05-01 because someone bothered to look. Most MSP dashboards never expose this — the breakage compounds in silence. |
| Optional TicketHub overlay | The Halo / Atera split between "monitoring tool" and "ticketing tool" forces context-switching every alert. One row that says "Acme has 3 critical alerts AND 1 open P1 ticket" cuts the round-trip. |

## 3. Dashboard composition

### 3.1 Top rail — "Needs your attention"

A horizontal strip of up to 6 cards. Each card is the single highest-leverage problem in one category:

1. **Oldest open critical alert** — `Fl_Alert.state="open" AND severity="critical"` ordered by `createdAt ASC`, take 1. Card shows client + title + age.
2. **Host with the most unpatched KEV CVEs** — `Fl_PatchInstall` joined to `Fl_CveAdvisory.kev=true`, grouped by `deviceId`, ordered by count DESC.
3. **Most-overdue scheduled report** — `Fl_ReportSchedule.nextFireAt < now() - 1h` ordered by `nextFireAt ASC`. (Should never normally hit; when it does, the schedule worker is wedged.)
4. **Stuck deploy** — `Fl_DeploymentTarget.state="installing"` with `lastTransitionAt < now() - 2h` (Phase 3's progress-complete-race gotcha applies).
5. **Hosts offline >24h** — `Fl_Device.lastSeenAt < now() - 24h AND isActive=true`. Card shows the count + the client with the most.
6. **Audit-chain tip mismatch** — re-walks the chain from a recent checkpoint; if any row hashes don't match, names the first offending row. (This is the exact check the evidence-zip already does.)

Rail items disappear when the underlying signal is null. An MSP on a calm day sees zero cards — that's a feature, not a bug. The rail isn't padded with greenchecks.

### 3.2 Triage table — one row per client

Columns, left to right:

| Column | Source | Drill-down link |
|---|---|---|
| Client name (+ aging-hardware chip when applicable) | `Fl_Tenant.name` or derived from `Fl_Device.clientName` | `/clients/[name]` |
| Risk score (numeric badge, color-tinted) | Composite (§4) | `/clients/[name]` |
| Open / critical alerts | `Fl_Alert` count by state + severity | `/clients/[name]?tab=alerts` |
| Hosts offline >24h | `Fl_Device.lastSeenAt` filter | `/clients/[name]?tab=devices&filter=offline-24h` |
| Hosts behind on patch | `Fl_PatchInstall.state="pending"` distinct deviceId | `/clients/[name]?tab=patches` |
| Oldest unpatched CVSS | `Fl_PatchInstall` joined to advisory severity, MAX cvss | `/patches?client=[name]&sort=cvss-desc` |
| Stuck deploys | `Fl_DeploymentTarget` running >2h | `/deployments?client=[name]&state=stuck` |
| Failed scripts (last 24h) | `Fl_ScriptRun.state="failed" AND createdAt > now() - 24h` | `/runs?client=[name]&state=failed` |
| Schedule freshness | min(`now() - Fl_ReportSchedule.lastFiredAt`) per client | `/reports/scheduled?client=[name]` |
| Audit chain tip | walks tip, returns "ok" or row id | `/audit?client=[name]` |
| **Optional:** open tickets | `tickethub.th_tickets` cross-schema | `https://tickethub.pcc2k.com/tickets?client=[name]` |

A cell with value 0 renders as a dim "—" not a stark zero. Tone tokens (ok / warn / bad / kev) drive cell color. Numbers are right-aligned, the client name is left-aligned, everything else is the existing FleetHub table treatment.

### 3.3 Filters bar

Above the table, below the rail. Single-line. Sticky on scroll.

- **Signal:** `all` | `alerts` | `offline` | `patches` | `deploys` | `scripts` | `schedules` | `audit`. Picking one collapses the table to clients with non-zero values in that column.
- **Severity threshold:** `all` | `critical-only` | `warn+` | `info+`. Default `warn+` — drops chatty info.
- **Scope chip:** when the operator has multi-scope access (Phase 1.5 of HIPAA-READY: `fleet_staff_client_scope`), a chip surfaces "viewing 11 of 12 clients" with a click-through to expand.
- All filters reflect in `?signal=...&severity=...` so the URL is shareable. No new client-side state machine.

## 4. Risk score

A single per-client number from 0 to 100+. **The score is for sorting only — never displayed as the headline of a client's health.** Operators read the constituent columns; the score just decides who's at the top.

Formula (v1, deliberately simple):

```
risk =
   10 * count(open critical alerts)
 +  3 * count(open warn alerts)
 +  5 * count(hosts offline > 24h)
 +  4 * count(unpatched KEV CVEs, summed across hosts)
 +  2 * count(hosts with any pending patch)
 +  3 * count(stuck deploys)
 +  4 * count(failed scripts last 24h)
 + 15 * (audit chain has any tip mismatch ? 1 : 0)
 +  6 * (any schedule last fired > 24h ago ? 1 : 0)
```

The weights are tuned to put the worst clients at the top in the small-MSP / homelab case. Tunable per-deployment via `Fl_Tenant.riskWeightsJson` (optional override). v1 ships the constants above; tuning UI lands in v1.5 if any operator actually asks.

The score is computed at request time — there's no `Fl_RiskScore` table. Cheap enough at the 10-client / 500-device tier; if scale changes, the rollup goes into a materialized view (§9).

## 5. Drill-down + Cmd-K integration

The dashboard is read-only. Every interaction is a navigation to an existing screen:

- Client row click → `/clients/[name]`.
- Any column cell click → the client-scoped page with the correct tab + filter pre-selected (links above).
- Rail card click → the single specific row that's burning (e.g., `/alerts/[id]`, not `/alerts`).

Cmd-K palette adds:

- `triage` → opens this dashboard
- `triage critical` → opens with `?severity=critical`
- `triage offline` → opens with `?signal=offline`
- `triage <client-name>` → opens with the client row scrolled into view + visually pulsed (URL anchor `#client-<id>`)
- `clear acks for <client>` → bulk-acks resolved alerts (not new, but worth surfacing here)

## 6. Permission model

The dashboard is rendered server-side under `requireSession()`. The page calls a new `listMspRollup({ scope })` lib function which:

1. Reads the caller's `fleet_staff_client_scope` join rows (Phase 1.5 punchlist).
2. Returns rows only for in-scope clients.
3. Drops the operator's session email + the resolved scope into an audit row (`action: "msp.dashboard.viewed"`) — *not* every page load (would spam the chain), but once per (operator, day, scope-hash). HIPAA §3 doesn't strictly require this, but it makes "who saw what about Acme last Tuesday" answerable.

Operators with `clients = [*]` (full access) see every row. Operators with `clients = [* except X]` don't see X — and crucially, the rail cards from X are also suppressed, so a junior tech can't infer "Acme is on fire" from a card they can't drill into.

## 7. Refresh model

v1 ships server-rendered with `dynamic = "force-dynamic"` + a visible `Generated HH:MM:SS UTC` stamp + a manual refresh button (just `router.refresh()`).

This is intentional. Reasons:

- The dashboard is read once per coffee, not 30x/min. Live SSE adds infrastructure for no operator-felt win at this tier.
- Server-side aggregation means the page is honest: every load reflects the DB at exactly the moment of render. No "stale cache" question.
- The Phase 5 perf-rollup cron already pre-aggregates the heaviest columns (hosts-behind, KEV count) into `Fl_PerformanceSample`, which the dashboard reads in O(N clients) not O(N devices).

v1.5 adds SSE for the rail cards only (table updates are noisy), if any operator asks.

## 8. UI surfaces

### `/` — unchanged

The current single-fleet stat-card dashboard (`getDashboardStats` in `app/lib/dashboard.ts`) stays exactly where it is. No content changes, no demotion to `/overview`. Operators with muscle memory keep what they have; Phase 6 is purely additive.

### `/msp` — new

The triage view. Sections in document order: header (with `Generated HH:MM:SS UTC` stamp + manual refresh), filters bar (§3.3), "Needs your attention" rail (§3.1), triage table (§3.2). Server-rendered, `dynamic = "force-dynamic"`, `requireSession()` + scope filter (§6).

### `/msp/export.csv`

Bearer-auth (`FLEETHUB_AGENT_SECRET`) endpoint returning the same rows as the dashboard, suitable for a daily "fleet posture" email-to-self. Reuses the `listMspRollup` aggregator.

### Sidebar

```
Dashboard        ←  unchanged, points at /
Triage           ←  NEW, points at /msp
Clients
Devices
Alerts
Patches
Deployments
Scripts
Reports
Audit
Settings
```

Triage sits directly below Dashboard so an operator can flip between the two without crossing the rest of the nav.

## 9. Performance considerations

Aggregation cost matters because every Phase 6 page load fans out queries across every in-scope client.

v1 strategy:
- One Prisma `$transaction([...])` batches N+1 reads into a single round-trip. Specifically:
  - `groupBy clientName from Fl_Device` → device counts + offline-counts
  - `groupBy clientName from Fl_Alert` → alert counts by severity
  - `groupBy clientName from Fl_PatchInstall` → patch posture (reuse Phase 5 cached values if present)
  - `Fl_DeploymentTarget` stuck count grouped by client
  - `Fl_ScriptRun` failed-last-24h grouped by client
  - `Fl_ReportSchedule` min(lastFiredAt) grouped by client
  - Audit chain tip check — single query at the fleet level, not per-client.
- Rail cards reuse the same query set, sorting differently in-memory.

Measured target: dashboard renders in **under 600ms** at 12 clients × 50 hosts × 30 alerts × 8 schedules. If we land outside that, §9.5 adds a `fl_msp_rollup` materialized view refreshed every 60s by the same cron that drives `Fl_PerformanceSample`.

## 10. Schema additions

**None for v1.** Pure read-side aggregation. The optional `Fl_Tenant.riskWeightsJson` field lands only if §4 weight-tuning gets demand.

v1.5 might add a `fl_msp_rollup` materialized view if measured perf demands it. Materialized views in Postgres are zero-Prisma-schema — they're created via raw SQL migration and queried via `$queryRaw`. Tracked separately when the time comes.

## 11. Sequencing inside Phase 6

Each step is a shippable container restart.

1. **`listMspRollup` lib + permission filter.** Pure data layer. No UI. Smoke-tested with the existing seed data.
2. **Triage table at `/msp`.** Static columns, default sort, no filters. Verifies the data shape end-to-end before any styling polish.
3. **Risk score + default sort.** The scoring constants from §4, applied server-side.
4. **"Needs your attention" rail.** Six cards, top-of-page, all linked.
5. **Filters bar + URL state.** `?signal=...&severity=...` plumbing.
6. **Sidebar entry + Triage label.** Add the new sidebar row pointing at `/msp`. No routing flip — `/` stays as today.
7. **TicketHub overlay column.** Cross-schema $queryRaw, gracefully hidden when TH is absent.
8. **Cmd-K commands.** `triage`, `triage critical`, etc.
9. **`/msp/export.csv` endpoint.** Bearer-gated, reuses §11.1 aggregator.

Step 2 is the sales-grade win even before scoring + rail land — once an operator sees all clients on one row, the rest is polish. Steps 1–4 are the v1 mandatory set; 5–9 are independently shippable extensions.

## 12. Open questions

- **TicketHub overlay coupling:** the read goes through cross-schema $queryRaw. If TicketHub schema changes, FleetHub silently breaks. Worth defining a typed view (`tickethub.fl_v_open_tickets_per_client`) that TH commits to as a contract? Probably yes — defer to Phase 6.1.
- **Risk score weights — operator-tunable or fixed?** v1 says fixed. If two operators read the table differently ("I care more about offline hosts than CVEs"), we get pressure for per-user weights. Probably wait for that demand before building.
- **Multi-MSP support (an MSP-of-MSPs):** if a parent MSP manages five sub-MSPs each managing their own client set, the rollup needs a two-level group-by. Out of scope; document it here and route to Phase 7 if it ever lands.
- **Trends:** showing a 7-day spark line per signal would be powerful, but adds a column-rendering pass and time-series read for every cell. Hold for v1.5 unless an operator misses it.
- **Mobile breakpoint:** the table has 11 columns. On phone, the rail + a card-per-client list is probably the right collapse. v1 is desktop-first; v1.5 ships the responsive variant.

## 13. Non-goals (out of scope for Phase 6)

- Live SSE / WebSocket updates. (Reserved for Phase 6.5 with measurable demand.)
- A separate per-MSP-tier configuration surface (branding, theme, etc.). Phase 5 owns reporting branding; the triage view is staff-only and stays MSP-themed.
- A customer-facing portal cut of this dashboard. (That's a different Phase 6 candidate; see PhaseChoice memo. The MSP triage table is internal-only.)
- Auto-remediation hooks ("acknowledge all warn alerts older than 7d"). Phase 6 reads; bulk-mutate lives in `/alerts` and `/runs`.
- Cross-MSP federation (sharing posture between two PCC2K-Agent deployments operated by different MSPs).

## 14. Voice check

Voice: this is the screen the tech opens with coffee. It should feel like a control room, not a dashboard. Every number must answer "do I need to do something about this in the next hour?" — and if the answer is no, the number is dim. If the answer is yes, the row is visibly red, and clicking the cell takes you to the action, not to a chart.

No tooltips. No "what's this metric?" question marks. No "kudos! 0 alerts" celebration banners. Number, color, link. Anything more is buried OpsHub-junior territory.
