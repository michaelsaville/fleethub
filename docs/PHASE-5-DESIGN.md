# FleetHub Phase 5 — Performance + Compliance Reports (Design)

**Status:** Draft, 2026-05-02. Not yet implemented. Phase 5 is gated on Phase 4 (patch management) shipping the patch-posture data shape — most Phase 5 reports consume Phase 4's `Fl_PatchInstall` + Phase 3's `Fl_DeploymentTarget` + Phase 1.5's audit chain as their data sources.

**Scope of this doc:** the design contract for the report kinds, the scheduling + delivery machinery, the PDF/CSV/JSON output formats, branded templates, evidence packaging for HIPAA / PCI / SOC 2, time-series performance aggregation, and the retention model. Like the prior phase docs: the spec IS the contract.

**Cross-references:**
- [`PHASE-2-DESIGN.md`](PHASE-2-DESIGN.md) — script run history feeds the activity reports
- [`PHASE-3-DESIGN.md`](PHASE-3-DESIGN.md) — deployment history + drift state feed software-rollout reports
- [`PHASE-4-DESIGN.md`](PHASE-4-DESIGN.md) §18 — `/api/reports/patch-compliance` is the canonical patch-state shape Phase 5 renders
- [`HIPAA-READY.md`](HIPAA-READY.md) §2 — audit-chain integrity is itself a reportable artifact
- [`UI-PATTERNS.md`](UI-PATTERNS.md) — Cmd-K, hyperlink-every-number, no-buried-config

---

## 1. What Phase 5 ships

Per FleetHub `README.md`:

> Phase 5 — Performance + compliance reports. PDFs ready for client review. ~3-4 weeks.

Concretely, by the end of Phase 5:

- A tech can hit `/reports`, pick a tenant + a report kind + a date range, and get a branded PDF in 30 seconds — no spreadsheet wrangling, no custom SQL.
- Five report kinds ship out-of-box: **Patch Compliance**, **Software Inventory**, **Performance Trend**, **Identity Posture** (when the M365 tenant audit is wired — that's a Scout integration, see §11), and the **Quarterly Business Review** (the executive-readable rollup).
- Reports are generated on-demand OR scheduled (cron'd) per-tenant. Scheduled reports email the PDF + post a thumbnail to a Slack/Teams webhook.
- Same PDF works for an internal tech briefing, a client QBR meeting, and an auditor evidence packet — driven by an `audience` flag that toggles section visibility (technical detail vs executive summary).
- HIPAA / PCI / SOC 2 evidence packaging: a single ZIP that bundles the audit-chain export, the patch-compliance PDF, the deployment history CSV, and the chain-of-custody manifest with SHA-256 hashes.
- Per-tenant report templates: logo, accent color, MSP name in header (defaults to PCC2K). Future: customer-supplied template upload.
- Generated artifacts retained per-tenant policy (default: 6 years per HIPAA retention; configurable down to 1 year for non-HIPAA).
- Cmd-K commands: `report patch-compliance for acme last-30d`, `schedule report patch-compliance for acme weekly monday-08:00`, etc.

## 2. The pain points this design is built around

Five design choices traced to documented incumbent failures:

| Decision | Counters this RMM failure |
|---|---|
| One PDF works for tech / client / auditor (audience flag toggles sections) | Most RMMs ship a tech-facing report that's unreadable to a client + a sanitized client report that's useless for an auditor; techs end up rebuilding both in Word |
| Scheduled-report Slack/Teams thumbnail with deep-link | Universal complaint: scheduled reports email a PDF nobody opens; thumbnail in chat = the report gets read |
| Multi-tenant cross-rollup ("compliance across all 12 clients") at the MSP tier | Automox-class limitation: reports must be pulled per-tenant, no cross-org rollup. MSP poison. |
| Evidence packaging with SHA-256 manifest | Auditors don't trust "look at this PDF" — they want the underlying data + hash chain showing it wasn't edited after generation |
| Performance time-series aggregation pre-computed by hourly cron | Naive per-host queries against multi-month telemetry tables fall over; Datto's "loading…" spinners that never resolve are the cautionary tale |

## 3. Report kinds (canonical five)

```prisma
model Fl_Report {
  id             String   @id @default(cuid())
  /// "patch-compliance" | "software-inventory" | "performance-trend"
  /// | "identity-posture" | "qbr"
  kind           String
  tenantName     String
  /// "tech" | "client" | "auditor" — toggles which sections render.
  audience       String   @default("client")
  /// Inclusive ISO date range. Some reports are point-in-time
  /// snapshots (asOf); others are intervals (start..end).
  asOf           DateTime?
  startDate      DateTime?
  endDate        DateTime?
  /// "pdf" | "csv" | "json" | "evidence-zip"
  format         String   @default("pdf")
  /// Generated artifact location (S3-compatible). Also stored locally
  /// on FleetHub for the retention period as a fallback.
  artifactUrl    String?
  artifactSha256 String?
  artifactBytes  Int?
  /// Generation context — cron schedule id (when scheduled) or
  /// operator email (when ad-hoc).
  generatedBy    String
  scheduleId     String?
  /// "queued" | "generating" | "ready" | "delivered" | "failed" | "expired"
  state          String   @default("queued")
  failureReason  String?
  /// Set to artifactBytes-equivalent + state="expired" after retention.
  retentionUntil DateTime
  generatedAt    DateTime?
  deliveredAt    DateTime?
  createdAt      DateTime @default(now())
  @@index([tenantName, kind, createdAt])
  @@index([state, retentionUntil])
}
```

### 3.1 Patch Compliance

The HIPAA / PCI / SOC 2 workhorse. Consumes `Fl_PatchInstall` + `Fl_PatchAdvisory` + `Fl_Patch` per Phase 4 §18.

Sections (audience-gated):
- **Cover** (all): tenant + date range + headline numbers (compliant hosts / total hosts / overdue critical).
- **SLA aging** (all): per-CVSS-band table (critical 7d / high 30d / medium 90d), within-SLA + overdue counts + mean-days-to-patch.
- **Per-host KB matrix** (tech, auditor): one row per host, columns are KBs, cells are installed-date / missing / failed / declined-with-reason. Wide table; renders landscape.
- **Exception list** (tech, auditor): hosts with operator-supplied opt-outs, with justification + approver email + audit-chain row hash.
- **Trend chart** (client): patch-compliance % over the date range; sparkline-style.
- **Recent KEV exposure** (all): CVEs that flipped to KEV during the window + how long the fleet was exposed.

CSV format: per-host-per-patch denormalized (long format) for spreadsheet pivot.

### 3.2 Software Inventory

Consumes `Fl_Package` + `Fl_PackageVersion` + `Fl_DeploymentTarget` (Phase 3) + per-host inventory.software (Phase 1).

Sections:
- **Catalog summary** (all): packages tracked + version drift count + outdated host count.
- **Drift by package** (tech, auditor): "Chrome 122 (44 hosts), 119 (3 hosts)" with per-host list (auditor only).
- **Heaviest hosts** (tech): top-15 hosts by installed-app count (potential bloat / unsanctioned-software signal).
- **Per-client install footprint** (client, tech): app-count rollup by client.
- **Recent deployments** (client, tech): last N deploys with success rate.

### 3.3 Performance Trend

Time-series aggregation. Consumes a new `Fl_PerformanceSample` table (see §6).

Sections:
- **Fleet health** (all): % hosts with sustained CPU > 80% / RAM > 90% / disk > 90% over the window.
- **Trend charts** (client, tech): aggregate CPU / RAM / disk usage over time; grouped by tenant.
- **Pressure list** (tech, auditor): top-N hosts by hours-over-threshold.
- **EOL / lifecycle aging** (client): hardware older than 4 years; OS approaching support end (Win 10 EOL 2025-10-14, etc.).
- **Capacity recommendations** (client): "Acme's average disk usage hit 78% over Q2 — recommend $X budget for storage upgrade." Phase 5+ may add Claude API hook for narrative generation.

### 3.4 Identity Posture (Scout integration)

When `Fl_Tenant.scoutTenantId` is set (per-client M365 audit lives in Scout — see scout-api docs), Phase 5 pulls the latest `IdentityAuditResults` from Scout and renders it as a FleetHub report. Sections mirror Scout's `IdentityPage` PDF: admin posture, tenant MFA %, stale users, Secure Score, CA policies.

For tenants without Scout binding, this report kind is hidden from the picker.

### 3.5 Quarterly Business Review (executive)

The "what to walk into a client meeting with" report. Audience defaults to `client`; tech audience adds drill-down detail.

Sections:
- **Cover** with tenant logo, period, executive summary (auto-narrative via Claude API hook — see §10).
- **Headline metrics**: hosts managed, patches applied, scripts executed, alerts resolved, deploys completed.
- **Wins** (client): notable resolved alerts, completed projects, security improvements.
- **Risk areas** (client): unpatched KEVs still in the fleet, EOL hardware, identity gaps from Scout.
- **Looking ahead** (client): planned upgrades, recommended investments, license renewals approaching.

Layout-heavy. The PDF template lives in `lib/pdf/QbrReport.tsx` — same `@react-pdf/renderer` pattern Scout uses, ASCII-only per the Helvetica rule.

## 4. Generation lifecycle

```
queued → generating → ready → delivered (when scheduled+delivered)
                            ↘ expired (after retentionUntil)
queued → generating → failed (operator can re-run)
```

- **Ad-hoc**: operator clicks `Generate` on `/reports/new`, row created `state=queued`, background worker picks up within seconds.
- **Scheduled**: `Fl_ReportSchedule` row + cron'd job creates `Fl_Report` rows + auto-delivers per the schedule's delivery config.
- **Generating**: render runs server-side. PDFs via `@react-pdf/renderer` (same dep Scout uses). Large PDFs (>10 MB) stream to S3-compatible storage; smaller stay inline.
- **Ready**: `artifactUrl` populated. Operator notified via in-app toast + (when scheduled) email/Slack.
- **Delivered**: scheduled reports auto-emailed + Slack-thumbnailed. Bumps `deliveredAt`.
- **Expired**: nightly cron clears `artifactUrl` (deletes from S3) and bumps state past `retentionUntil`. Metadata row stays for audit forever.

## 5. Scheduling

```prisma
model Fl_ReportSchedule {
  id            String   @id @default(cuid())
  tenantName    String
  kind          String   // matches Fl_Report.kind
  audience      String   @default("client")
  format        String   @default("pdf")
  /// Cron expression in tenant timezone.
  cron          String   // "0 8 * * 1"  (Mon 08:00)
  timezone      String   @default("UTC")
  /// Date-range relative to scheduled fire time.
  /// "last-7d" | "last-30d" | "last-90d" | "month-to-date" | "quarter-to-date"
  dateRange     String   @default("last-30d")
  /// JSON: { email?: { to: [], cc: [] }, slack?: { webhookUrl } }
  deliveryJson  String
  isActive      Boolean  @default(true)
  /// Last successful delivery (for cron-skew detection).
  lastFiredAt   DateTime?
  createdBy     String
  createdAt     DateTime @default(now())
  @@index([tenantName, isActive])
}
```

The delivery payload supports email (SMTP — reuse the existing TicketHub mailer pattern) + Slack/Teams webhook. Slack delivery posts a thumbnail (first page of the PDF rendered to PNG via `pdf-poppler` or similar) plus a deep-link to the full PDF in FleetHub. Thumbnail-in-chat is the difference between "scheduled report nobody opens" and "scheduled report read in 5 seconds."

## 6. Performance time-series

New per-host aggregated sample table. Agent reports raw 1-minute samples via `inventory.report` (already shipped); a server-side hourly cron rolls them up into the aggregation table.

```prisma
model Fl_PerformanceSample {
  id             String   @id @default(cuid())
  deviceId       String
  /// Aggregation window. "1h" | "1d" | "7d"
  window         String
  /// Window start (inclusive). UTC.
  windowStart    DateTime
  cpuAvgPct      Float
  cpuP95Pct      Float
  ramAvgPct      Float
  ramP95Pct      Float
  diskUsedPct    Float
  /// Network bytes-in/out summed across interfaces.
  netInBytes     BigInt
  netOutBytes    BigInt
  uptimeSec      BigInt
  /// Count of agent.heartbeat misses in this window — gaps in
  /// monitoring affect report confidence.
  missedHeartbeats Int @default(0)
  createdAt      DateTime @default(now())
  @@unique([deviceId, window, windowStart])
  @@index([window, windowStart])
}
```

Three rollup tiers:
- **1h** — kept 30 days. The high-resolution working set.
- **1d** — kept 13 months. The trend-chart data source.
- **7d** — kept 6 years. The long-term retention tier matching HIPAA.

Hourly cron rolls 1-minute samples → 1h rows; daily cron rolls 1h → 1d; weekly cron rolls 1d → 7d. Pre-computation is the difference between sub-second report renders and "loading…" spinners that never resolve.

## 7. Evidence packaging (HIPAA / PCI / SOC 2)

The single-ZIP "give this to your auditor" artifact. Generated by the same render pipeline; format is `evidence-zip` instead of `pdf`.

ZIP contents:

```
patch-compliance-acme-2026Q1.pdf      # the human-readable report
patch-compliance-acme-2026Q1.csv      # underlying per-host-per-patch data
audit-log-export-2026Q1.csv           # Fl_AuditLog rows for the period
audit-chain-verification.txt          # output of /api/audit/verify (chain valid?)
deployments-2026Q1.csv                # all software + patch deploys
exceptions-2026Q1.csv                 # operator opt-outs + justifications
manifest.json                         # see below
README.txt                            # auditor-friendly walkthrough
```

`manifest.json`:

```jsonc
{
  "generatedAt": "2026-04-30T23:59:59Z",
  "generatedBy": "mike@pcc2k.com",
  "tenant": "Acme Corp",
  "period": { "start": "2026-01-01", "end": "2026-03-31" },
  "auditChainTipHash": "<sha256>",     // proves nothing was inserted later
  "files": [
    { "name": "patch-compliance-acme-2026Q1.pdf",
      "sha256": "...", "bytes": 1234567 },
    …
  ],
  "fleethubVersion": "5.0.0",
  "agentVersionRange": ["1.4.2", "1.4.5"]
}
```

The auditor's question "how do I know this wasn't edited after generation?" is answered by:
1. Each file's SHA-256 in the manifest.
2. The audit-chain tip hash (per HIPAA-READY §2) — any forensic check can re-walk the chain and confirm continuity.
3. The manifest itself is signed (Ed25519) by the generating tenant's compliance key (Phase 2's signing infrastructure).

## 8. UI surfaces

### `/reports` — landing

```
┌────────────────────────────────────────────────────────────────┐
│ Reports                                                        │
│ Generated · 12 · Scheduled · 4 · Failed · 0                    │
│                                                                │
│ Tabs: Recent · Scheduled · Generate                            │
│                                                                │
│ ┌─ Recent ──────────────────────────────────────────────────┐ │
│ │ Patch compliance · Acme · Q1 2026 · ready · 2.3 MB · ↓   │ │
│ │ QBR · Bridgeway · Q1 2026 · ready · 1.8 MB · ↓ · ✉ sent  │ │
│ │ Performance · Acme · last 30d · ready · 0.4 MB · ↓       │ │
│ └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### `/reports/new` — generate ad-hoc

Single form: tenant picker · kind picker · audience toggle · date range · format. Submit creates `Fl_Report` row, redirects to `/reports/[id]` showing live state (queued → generating → ready).

### `/reports/[id]` — single report

Live state strip (state + size + age) · download button when ready · share-link generator · per-section preview (PDF inline via `<embed>`).

### `/reports/scheduled` — schedule editor

CRUD over `Fl_ReportSchedule`. Tenant + kind + cron + delivery (email/Slack) + dateRange. "Run now" button to test a scheduled report without waiting for the cron fire.

### Cmd-K extensions

```
report <kind> for <tenant> [<dateRange>]   → /reports/new pre-filled, auto-submit
schedule report <kind> for <tenant>         → /reports/scheduled/new pre-filled
share report <reportId>                     → generates a signed share link
download evidence <tenant> <quarter>        → generates evidence-zip + downloads
```

### Sidebar

`/reports` already exists in the Phase 0 sidebar. Phase 5 just makes it live.

## 9. Schema additions (full delta vs Phase 4)

```prisma
model Fl_Report          { … see §3 … }
model Fl_ReportSchedule  { … see §5 … }
model Fl_PerformanceSample { … see §6 … }

model Fl_Tenant {
  // existing Phase 4 fields remain
  /// Per-tenant branding for report PDFs.
  reportLogoUrl       String?
  reportAccentColor   String  @default("#F97316")
  reportFooterText    String?
  /// Days to retain generated artifacts. HIPAA default = 6 * 365.
  reportRetentionDays Int     @default(2190)
  /// FK into the Scout app's Prospect/Identity audit, when wired.
  /// Lets the Identity Posture report pull from Scout for this tenant.
  scoutTenantId       String?
}
```

## 10. Optional Claude API hook for executive narrative

The QBR cover-page summary ("This quarter Acme had X patches deployed, Y alerts resolved, Z hosts onboarded — overall posture improved 12%.") is the kind of thing a tech rewrites every quarter for every client. Phase 5 adds an optional Claude API hook (via the existing DocHub AI proxy at `/api/ai/proxy`) that takes the structured report data + tenant context and emits a 3-paragraph narrative.

Operator-controllable per-tenant: `Fl_Tenant.qbrAutoNarrative` defaults to false. When enabled, the narrative is generated on report build and embedded in the PDF. The original structured data is retained in the report metadata so the narrative is always re-derivable from the same inputs.

This is a Phase 5.5 polish — ship the report machinery first, layer narrative on top once we see how operators use the raw output.

## 11. Sequencing inside Phase 5

Bite-sized landings:

1. **Schema + protocol freeze.** `Fl_Report`, `Fl_ReportSchedule`, `Fl_PerformanceSample`. This design doc.
2. **Patch Compliance report (PDF only, ad-hoc).** First report kind. Reuses Phase 4's `/api/reports/patch-compliance` endpoint. PDF render via `@react-pdf/renderer`.
3. **Performance time-series rollup cron.** Hourly + daily + weekly aggregation jobs. Backfill from existing `inventory.report` data once.
4. **Performance Trend report (PDF, ad-hoc).**
5. **Software Inventory report.**
6. **`/reports` landing + `/reports/new` form + `/reports/[id]` viewer.**
7. **Scheduling.** `Fl_ReportSchedule` + cron worker + email delivery.
8. **Slack/Teams thumbnail delivery.**
9. **QBR report (with Claude API narrative as opt-in).**
10. **Identity Posture report** — Scout integration.
11. **Evidence ZIP packaging.**
12. **Per-tenant branding** (logo upload, accent color, footer text).
13. **HIPAA-mode soak.** Verify retention enforcement, audit-chain tip hash inclusion, manifest signing.

Each step is a shippable container restart. The Patch Compliance PDF (step 2) is the sales-grade win even before scheduling lands — operators hand it to clients in the next QBR.

## 12. Open questions

- **PDF render cost at scale.** `@react-pdf/renderer` is fine for 50-page reports; the per-host KB matrix in a 200-host fleet is 1000+ rows + landscape pagination = potentially slow render. Pre-paginate server-side; cap per-PDF rows with "see CSV for full data" footer.
- **Time-series storage growth.** 1-minute samples × 200 hosts × 90 days = 26M rows in the inventory tier. Aggregation tier is modest (1h × 200 hosts × 30d = 144K rows; 1d × 200 hosts × 13mo = 79K). Decision: drop the 1-minute raw samples after 30 days; Phase 5 only retains aggregates beyond that.
- **Email delivery infrastructure.** Reuse the TicketHub SMTP setup (already wired) or self-host. Lean on TicketHub since it already handles bounces, threading, etc.
- **Slack/Teams webhook auth model.** Per-tenant or per-schedule? Per-schedule is more flexible; per-tenant simpler. Lean per-schedule since one tenant might want different channels for different report kinds.
- **Multi-tenant cross-rollup reports** ("MSP-wide patch compliance across all 12 clients on one PDF"). Not in v1. Phase 5.5 since cross-tenant aggregation is a different read path.
- **Customer-supplied PDF templates.** Tenants want their own brand on reports. v1 ships logo + color + footer text; full template upload (override the React-PDF JSX) is Phase 6+.
- **Report-level access control.** Currently any signed-in staff can generate any report. Should client-portal users get read-only access to their own tenant's reports? Defer until the first client asks.

## 13. Non-goals (out of scope for Phase 5)

- **Real-time dashboards** as reports. Dashboards are FleetHub's main UI; reports are point-in-time / interval snapshots delivered as files.
- **Custom SQL report builder.** Operators get the canonical five kinds + scheduled flexibility; if they need something else, that's a `/api/reports/raw` JSON dump fed into their own BI tool.
- **Cost-recovery / billing reports.** TicketHub owns billing; FleetHub doesn't track time-billed.
- **Per-user activity reports** (which tech ran which scripts). Already in `/audit` (Phase 1.5); doesn't need a separate Phase 5 surface.
- **Multi-tenant cross-rollup PDFs** (Phase 5.5).
- **AI-generated remediation recommendations.** Different from QBR narrative — that's about *describing* posture; recommendations are about *changing* it. Future phase tightly coupled to Phase 4 patch-prioritization signals.
- **PDF localization.** English only. The clinical-MSP fleet is all en-US.

## 14. Voice check

Same as Phase 2 / 3 / 4. Spec IS the contract; deviations require updating this doc first.

The honest acknowledgments — PDF render cost concern in §12, time-series storage trade-off, the Claude-API narrative being deliberately opt-in — match the patch-management doc's posture: ship what works, tell the truth about what's expensive or aspirational.

This closes the design contract for FleetHub's full ~9-12 month roadmap. Phases 0 → 5 are now spec'd. The remaining work is implementation; nothing in the design loop is missing.
