# UI patterns — what FleetHub copies, what it deliberately doesn't

Sibling doc to `HIPAA-READY.md`. Where HIPAA-READY locks engineering
constraints, this locks UX constraints. Synthesized from a deep dive
into SyncroMSP, ConnectWise RMM, and Datto RMM (2026-04-28 — research
results saved alongside this commit history).

This doc is the constitutional UX spec. Implementation deviations need
the doc updated first.

---

## Things to copy (universal across the big three)

These showed up in *all three* products and were praised by techs in
reviews. They're the table stakes:

1. **Per-device detail page is the most-used screen** — it's where techs
   spend time. Big visible action bar at the top (Remote, Quick Job,
   Patch Now, Reboot, ⋯). Tabs below for different facets (Summary,
   System, Patches, Scripts, Software, Network, Activity, Alerts).

2. **Right-click context menu** on every list row. Devices, alerts,
   scripts, even rows in dashboard widgets. Common actions surface
   here so techs never have to navigate-click-navigate.

3. **One-click remote access** from list view. Browser-based RDP/web
   remote launch in a single click — never two, never a wizard. If
   we can't make it fast (Datto's complaint), don't ship it.

4. **Drag-reorderable dashboard widgets**, per-user saved. The
   customization happens *on the dashboard* (drag the card), not
   buried in a settings page (ConnectWise complaint).

5. **Hyperlinked KPIs → filtered list**. Every number on the dashboard
   ("47 stale tickets", "12 critical alerts", "3 hosts offline >1h")
   is a link that drills into the filtered list. Cheap to do day one;
   impossible to retrofit if widgets emit static numbers.

6. **Activity / communications log** as a first-class component on
   detail pages. Email + call + visit history per client, command
   execution history per device, sorted by recency. Same component
   reused everywhere, populated by the audit log.

7. **Pre-built script library** with categories + tags + search. *But*
   curated aggressively (Datto ComStore failure mode: "marketplace
   full of broken/outdated scripts negates its value"). Quality over
   quantity; if a script in the library breaks, fix it or remove it.

8. **Bulk operations** on every list (alerts, devices, patches). Page
   header checkbox selects-all-on-page, individual checkboxes per
   row, bulk-action bar appears when >0 selected. Resolve, dismiss,
   move, run script, etc.

9. **Parent/child task hierarchies** (Syncro pattern). Multi-step jobs
   (patch rollout, project tickets) split into children, rolled up to
   parent. Apply this to FleetHub job orchestration.

10. **Time tracking glued to work** (Syncro). Timer starts when a
    technician opens a device for action; stops on close; rolls into
    a ticket if one's open. Don't make techs remember to click "start
    timer."

---

## Differentiators — things the big three DON'T do

Easy wins because nobody's done them well:

1. **Global Cmd-K command palette.** ConnectWise has no global search
   at all; Datto's F-key is keyword-only (matches names, not actions).
   A Cmd-K palette like Linear/Notion that fuzzy-finds both *entities*
   ("sarah smith") and *commands* ("reset password sarah smith" → lands
   directly on the action) is genuinely category-leading UX.

2. **Dark mode native.** ConnectWise needs a browser extension; Datto
   doesn't have it; Syncro added it to the dashboard but not
   consistently. PCC2K's stack is dark by default (DocHub, OpsHub) —
   keep that aesthetic.

3. **PWA-grade mobile.** Syncro's mobile app is reportedly clunky;
   ConnectWise / Datto don't push mobile. A solid responsive web app
   that installs as a PWA, with web-push notifications for alerts,
   beats all three.

4. **HIPAA-by-construction.** None of the big three market this.
   `docs/HIPAA-READY.md` is a real differentiator for healthcare-
   serving MSPs.

5. **AI-assisted scripting from the start.** ConnectWise's "Sidekick"
   is the only one offering it. Generating PowerShell from a typed
   description is a real productivity multiplier; we have a Claude
   API proxy already (`project_dochub_ai_proxy.md`), so adding it is
   cheap.

6. **Password-injection on remote sessions** (Datto has it, others
   don't, techs love it). Tech selects "inject admin creds" from a
   menu; the password is typed as keystrokes into the remote session
   without the tech ever seeing the value. Significant security +
   UX win for HIPAA contexts.

---

## Things to deliberately AVOID (universal complaints)

These came up across reviews. Designing around them up front is way
cheaper than retrofitting:

1. **🚨 Locked column widths/order** — ConnectWise's #1 complaint,
   "beyond frustrating." Every list column resizable + reorderable +
   savable as a personal/shared view. Non-negotiable; it's the
   single highest-impact "don't do this" finding from the research.

2. **Inconsistent visual styles between sections.** ConnectWise's
   mid-Asio-migration is the cautionary tale ("different sections in
   different styles is confusing"). Pick one design system day one
   (CSS variables + inline styles, mirroring DocHub) and apply
   uniformly. Don't ship a "modern" page next to a "legacy" page.

3. **Configuration buried in settings.** Personalization should
   happen on the page being personalized — column visibility, widget
   ordering, view filters all save *from the page*, not via a
   navigate-to-settings round trip.

4. **Slow remote access.** Datto's Web Remote is universally panned
   ("very slow and generally unresponsive"). If we ship browser-
   based RDP via Guacamole (Phase 4), it has to be perceptibly fast
   or we don't ship it.

5. **Steep learning curve / poor discoverability.** Datto and
   ConnectWise both lose new techs here. Build a tooltip layer that
   appears on first use, plus a "did you know" panel on the empty
   state of every page that shows a 30-second walkthrough.

6. **Update-treadmill instability.** Datto under Kaseya. Ship
   slower with a stable cadence over chasing feature parity. Each
   release backwards-compatible at the API + DB level.

7. **Outdated marketplace content** (Datto ComStore). If we have a
   pre-built script library, every script is curated by us and tested
   on a fresh Win11/Server2022/Ubuntu24 VM in CI. A broken script
   ships zero. Quality > quantity.

8. **Non-customizable alert/ticket subjects** before creation
   (ConnectWise complaint). Every alert→ticket template should be
   editable per-client.

---

## Concrete FleetHub shape

```
┌── Sidebar (collapsible to icons-only) ───────────────────────┐
│ 🏠 Dashboard       │ ┌── Top bar ────────────────────────────┐│
│ 🏢 Clients         │ │ Cmd-K search · alerts ●3 · me        ││
│ 💻 Devices         │ ├──────────────────────────────────────┤│
│ 🔔 Alerts ●3       │ │                                      ││
│ 🩹 Patches         │ │     main content area                ││
│ ⚡ Scripts          │ │     (dark theme; dense not cramped)  ││
│ 📦 Software        │ │                                      ││
│ 📊 Reports         │ │                                      ││
│ ⚙  Setup           │ └──────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Sidebar (in this order, intentionally)

1. **Dashboard** — drag-reorderable widgets, every KPI hyperlinked
2. **Clients** — list of consented clients; click in to per-client view
3. **Devices** — flat fleet-wide list with filters (client, OS,
   online, alerts); the most-used list view
4. **Alerts** — bulk-select + bulk-resolve; drill in for timeline +
   remediation actions
5. **Patches** — by-client patch coverage matrix + rollout queue
6. **Scripts** — curated library + run history + new-script editor
7. **Software** — deployments queue + per-host inventory rollup
8. **Reports** — scheduled + ad-hoc, exportable as PDF for clients
9. **Setup** — agent enrollment, integrations, staff allowlist,
   alert rules

### Top bar (every page)

- **Cmd-K** opens the global palette (entity search + commands)
- **Alert badge** on the bell icon — counts unresolved alerts; click
  for inline panel + "view all" link to /alerts
- **Profile menu** — sign out, theme toggle (default dark), version,
  help

### Device detail page (the most-used screen)

```
[host: msaville-laptop · 🟢 Online · client: Acme · last seen 2m]
[ 🖥 Remote ]  [ ⚡ Quick Job ]  [ 🩹 Patch Now ]  [ 🔄 Reboot ]  [ ⋯ ]

Tabs:  Summary · System · Patches · Scripts · Software · Network · Activity · Alerts

──── Summary tab content ────
┌─ Health card ───────────────┐  ┌─ OS / hardware ──────────┐
│ CPU 12% · RAM 64%           │  │ Win 11 Pro · 32 GB RAM   │
│ Disk C: 71%                 │  │ i7-13700H · 1 TB NVMe    │
│ Uptime 4d 3h                │  │ Domain: acme.local       │
└─────────────────────────────┘  └──────────────────────────┘

┌─ Recent activity (last 7d) ─────────────────────────────────┐
│ 14m ago · patch KB5036893 installed · ok                    │
│ 2h ago  · script CleanTempFiles.ps1 by mike · 0 errors      │
│ 1d ago  · alert resolved: "Disk C: > 90%"                   │
│ 3d ago  · agent updated 1.4.2 → 1.4.3                       │
└─────────────────────────────────────────────────────────────┘
```

### Cmd-K palette behavior

Three categories of results, in this order:

1. **Commands** — "reset password sarah smith", "patch now
   acme-dc01", "run script cleantemp on acme fleet". The palette
   parses partial input and suggests commands; ENTER executes
   directly (with destructive-action confirm modal where needed).
2. **Entities** — devices, clients, users, scripts, alerts, runbooks.
   Fuzzy-matched. ENTER opens the entity's detail page.
3. **Recent** — last 5 things you opened. Useful when bouncing
   between tickets.

Keyboard everywhere: `↑/↓` to navigate, `ENTER` to select, `ESC` to
close, `TAB` to switch category.

---

## Phase 1 build order (UI-first priorities)

When Phase 1 of FleetHub starts (after the agent is designed in
OpsHub Phase 2), build in this order to set the right foundation:

1. **Cmd-K palette first.** Build it before any page beyond the
   dashboard. Once it works, every new feature is "add a command"
   not "add a navigation target." The spine of the UX.
2. **Pick one styling system day one.** Inline styles + CSS variables
   like DocHub — not Tailwind utilities; we're matching the existing
   PCC2K aesthetic and avoiding the "different sections look
   different" failure.
3. **Resizable + reorderable columns** with saved views — built into
   the table component before any list page renders. Not a "we'll
   add it later" — retrofitting list state management is expensive.
4. **Activity-log component as first-class.** A reusable
   `<ActivityFeed clientName=... deviceId=... />` that lives on every
   detail page. Populated by the audit log; same component reused.
5. **Hyperlink every dashboard number.** When we render the first
   dashboard widget showing "12 alerts," it must be a link to the
   filtered list — cheap day one, expensive to retrofit.

---

## Sources

Synthesized from:

- SyncroMSP: official docs (`docs.syncromsp.com`), G2/Capterra
  reviews, r/msp threads, recent UI/UX refresh announcement
- ConnectWise RMM (Asio era): `connectwise.com/platform/rmm` and
  related, G2/Capterra/r/msp reviews, ProVal Tech blog, ScreenConnect
  integration docs, public Asio modernization announcements
- Datto RMM (Kaseya era): `rmm.datto.com/help`, G2/Capterra reviews,
  r/msp threads, Kaseya UI deprecation FAQ, Flamingo and other
  independent reviews

Detailed agent reports archived in this commit's parent conversation;
condensed conclusions live here.
