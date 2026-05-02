import Link from "next/link"
import AppShell from "@/components/AppShell"
import SeedBanner from "@/components/SeedBanner"
import SeedPatchesButton from "@/components/SeedPatchesButton"
import { mockMode } from "@/lib/devices"
import { getSessionContext } from "@/lib/authz"
import {
  getDevicesNeedingPatches,
  getFleetPatchPosture,
  getPerClientPatchRollup,
  getStaleCheckIns,
} from "@/lib/patches"
import type {
  ClientPatchRollup,
  DevicePatchRow,
  FleetPatchPosture,
  StaleCheckInRow,
} from "@/lib/patches"
import { getVulnerableRows, getVulnerableSummary } from "@/lib/vulnerable"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

type TabId = "vulnerable" | "posture" | "perclient" | "catalog"
const TABS: { id: TabId; label: string }[] = [
  { id: "vulnerable", label: "🚨 Vulnerable" },
  { id: "posture", label: "Posture" },
  { id: "perclient", label: "Per-client" },
  { id: "catalog", label: "Catalog" },
]

/**
 * Phase 4 patches UI. Primary tab is **Vulnerable** (CVE-driven) per
 * PHASE-4-DESIGN §13. Posture / per-client / catalog are secondary.
 *
 * v1 reads from real Fl_Patch + Fl_PatchAdvisory + Fl_PatchInstall
 * tables. Catalog ingest is a one-shot ADMIN seed (CISA KEV pull is
 * real; MS patch catalog is hand-curated mock per PHASE-4-DESIGN §16
 * open question on MS Update Catalog API access).
 */
export default async function PatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const sp = await searchParams
  const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? "vulnerable")
  const ctx = await getSessionContext()
  const isAdmin = ctx?.role === "ADMIN"
  const isMock = await mockMode()

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Patches
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: "640px" }}>
              CVE-driven patch posture across the fleet. Vulnerable tab leads
              with KEV-flagged CVEs you should close today; per-CVE rows link
              to the closing KB + the affected hosts.
            </p>
          </div>
          {isAdmin && <SeedPatchesButton />}
        </header>

        {isMock && <SeedBanner kind="fleet" />}

        <nav style={{ display: "flex", gap: 2, borderBottom: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const active = t.id === tab
            return (
              <Link
                key={t.id}
                href={`/patches?tab=${t.id}`}
                style={{
                  padding: "8px 14px",
                  fontSize: 12,
                  color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  fontWeight: active ? 600 : 400,
                  borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                  marginBottom: "-0.5px",
                  textDecoration: "none",
                }}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>

        {tab === "vulnerable" && <VulnerableTab />}
        {tab === "posture" && <PostureTab />}
        {tab === "perclient" && <PerClientTab />}
        {tab === "catalog" && <CatalogTab />}
      </div>
    </AppShell>
  )
}

// ─── Vulnerable tab ─────────────────────────────────────────────────

async function VulnerableTab() {
  const [rows, summary] = await Promise.all([
    getVulnerableRows(),
    getVulnerableSummary(),
  ])

  return (
    <>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        <Tile label="CVEs tracked" value={String(summary.totalCves)} hint="from CISA KEV" />
        <Tile label="KEV-flagged" value={String(summary.kevCves)} hint="actively exploited" tone={summary.kevCves > 0 ? "danger" : "ok"} />
        <Tile label="Ransomware-known" value={String(summary.ransomwareCves)} hint="CISA flagged" tone={summary.ransomwareCves > 0 ? "danger" : "ok"} />
        <Tile label="Affected devices" value={String(summary.affectedDevices)} hint="missing ≥1 patch" tone={summary.affectedDevices > 0 ? "warn" : "ok"} />
        <Tile label="Fully patched" value={String(summary.fullyPatchedDevices)} hint="across fleet" tone="ok" />
      </section>

      {rows.length === 0 ? (
        <Card title="Vulnerable">
          <Empty>
            No vulnerable patches detected yet. Click <strong>Seed catalog + CVE feed</strong> in the
            header to bootstrap the demo data (real CISA KEV pull + mock MS KB catalog +
            per-host install state). Real ingest paths land with the Go agent —
            see <code>PHASE-4-DESIGN §16</code>.
          </Empty>
        </Card>
      ) : (
        <Card title={`Open CVEs · ${rows.length}`}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r) => (
              <li
                key={r.cveId}
                style={{
                  padding: "10px 12px",
                  border: "0.5px solid var(--color-border-tertiary)",
                  borderLeft: r.isKev ? "3px solid var(--color-danger)" : (r.cvssBase ?? 0) >= 7 ? "3px solid var(--color-warning)" : "3px solid var(--color-text-muted)",
                  borderRadius: 6,
                  background: "var(--color-background-tertiary)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {r.isKev && <span style={pill("var(--color-danger)")}>KEV</span>}
                  {r.ransomwareUseKnown && <span style={pill("#7c2d12")}>RANSOMWARE</span>}
                  {r.cvssBase != null && <span style={pill(cvssColor(r.cvssBase))}>CVSS {r.cvssBase.toFixed(1)}</span>}
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, fontWeight: 600 }}>
                    {r.cveId}
                  </span>
                  <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                    {[r.vendor, r.product].filter(Boolean).join(" · ")}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: r.affectedDeviceCount > 0 ? "var(--color-danger)" : "var(--color-success)", fontWeight: 600 }}>
                    {r.affectedDeviceCount} host{r.affectedDeviceCount === 1 ? "" : "s"} affected
                  </span>
                </div>
                {r.description && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                    {r.description.length > 280 ? r.description.slice(0, 280) + "…" : r.description}
                  </p>
                )}
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {r.closingPatches.map((c) => (
                    <div
                      key={c.patchId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 10px",
                        background: "var(--color-background)",
                        border: "0.5px solid var(--color-border-tertiary)",
                        borderRadius: 5,
                        fontSize: 12,
                      }}
                    >
                      <Link
                        href={`/patches/${c.patchId}`}
                        style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                      >
                        {c.sourceId}
                      </Link>
                      <span style={{ color: "var(--color-text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.title}
                      </span>
                      {c.isHotpatch && <span style={pill("var(--color-success)")}>HOTPATCH</span>}
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                        {c.missingDeviceCount} missing
                      </span>
                      <span style={pill(approvalColor(c.approvalState))}>
                        {c.approvalState}
                      </span>
                      {c.missingDeviceCount > 0 && c.approvalState === "approved" ? (
                        <DeployLink patchId={c.patchId} affectedDeviceIds={r.affectedDeviceIds} />
                      ) : c.missingDeviceCount > 0 ? (
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                          approve to deploy
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function DeployLink({ patchId, affectedDeviceIds }: { patchId: string; affectedDeviceIds: string[] }) {
  const params = new URLSearchParams({
    patchId,
    targets: affectedDeviceIds.join(","),
  })
  return (
    <Link
      href={`/deployments/new?${params.toString()}`}
      style={{
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 4,
        background: "var(--color-accent)",
        color: "#fff",
        textDecoration: "none",
        fontWeight: 600,
      }}
    >
      Deploy →
    </Link>
  )
}

function pill(bg: string): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 7px",
    borderRadius: 3,
    background: bg,
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  }
}
function cvssColor(score: number): string {
  if (score >= 9) return "var(--color-danger)"
  if (score >= 7) return "var(--color-warning)"
  if (score >= 4) return "#854d0e"
  return "var(--color-text-muted)"
}
function approvalColor(state: string): string {
  if (state === "approved") return "var(--color-success)"
  if (state === "needs-approval") return "var(--color-warning)"
  if (state === "deferred") return "var(--color-text-muted)"
  return "var(--color-danger)"
}

// ─── Existing tabs (unchanged behavior, wrapped for tab system) ─────

async function PostureTab() {
  const [posture, needingPatches, staleCheckIns] = await Promise.all([
    getFleetPatchPosture(),
    getDevicesNeedingPatches(12),
    getStaleCheckIns(7),
  ])
  return (
    <>
      <PostureStrip posture={posture} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16 }}>
        <DevicesNeedingCard rows={needingPatches} />
        <StaleCheckInCard rows={staleCheckIns} />
      </div>
    </>
  )
}

async function PerClientTab() {
  const rows = await getPerClientPatchRollup()
  return <ClientRollupCard rows={rows} />
}

async function CatalogTab() {
  const patches = await prisma.fl_Patch.findMany({
    orderBy: [{ ingestedAt: "desc" }],
    take: 200,
  })
  return (
    <Card title={`Catalog · ${patches.length}`}>
      {patches.length === 0 ? (
        <Empty>Catalog is empty. Use the Seed button in the header.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <th style={th()}>Source</th>
              <th style={th()}>ID</th>
              <th style={th()}>Title</th>
              <th style={th()}>OS</th>
              <th style={th()}>CVEs</th>
              <th style={th()}>Approval</th>
            </tr>
          </thead>
          <tbody>
            {patches.map((p) => {
              const cves = parseCveList(p.cveJson)
              return (
                <tr key={p.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <td style={td()}>
                    <span style={pill(sourceColor(p.source))}>{p.source}</span>
                  </td>
                  <td style={td()}>
                    <Link href={`/patches/${p.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 500 }}>
                      {p.sourceId}
                    </Link>
                  </td>
                  <td style={td()}>{p.title}</td>
                  <td style={td()}>{p.os}</td>
                  <td style={td()}>
                    {cves.length === 0 ? <span style={{ color: "var(--color-text-muted)" }}>—</span> : `${cves.length}`}
                    {p.isKev && <span style={{ ...pill("var(--color-danger)"), marginLeft: 6 }}>KEV</span>}
                  </td>
                  <td style={td()}>
                    <span style={pill(approvalColor(p.approvalState))}>{p.approvalState}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function parseCveList(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === "string")
  } catch {
    return []
  }
}
function sourceColor(s: string): string {
  if (s === "ms") return "#3c82f6"
  if (s === "thirdparty") return "#a855f7"
  return "#10b981"
}

// ─── Existing helper components copied/inlined to keep this single file ─

function PostureStrip({ posture }: { posture: FleetPatchPosture }) {
  const patchedPct = posture.devices > 0 ? Math.round((posture.fullyPatched / posture.devices) * 100) : 0
  return (
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
      <Tile label="Devices" value={String(posture.devices)} hint="reporting" />
      <Tile label="Fully patched" value={`${posture.fullyPatched}/${posture.devices}`} hint={`${patchedPct}%`} tone={patchedPct === 100 ? "ok" : "warn"} />
      <Tile label="Pending updates" value={String(posture.pendingTotal)} hint={`${posture.withPending} hosts`} tone={posture.withPending > 0 ? "warn" : "ok"} />
      <Tile label="Failed installs" value={String(posture.failedTotal)} hint={`${posture.withFailed} hosts`} tone={posture.failedTotal > 0 ? "danger" : "ok"} />
      <Tile label="Stale check-in" value={String(posture.staleCheck)} hint=">7 days" tone={posture.staleCheck > 0 ? "warn" : "ok"} />
    </section>
  )
}

function Tile({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const color =
    tone === "danger" ? "var(--color-danger)" :
    tone === "warn" ? "var(--color-warning)" :
    tone === "ok" ? "var(--color-success)" :
    "var(--color-text-primary)"
  return (
    <div style={{ padding: "10px 12px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 3 }}>{hint}</div>
    </div>
  )
}

function ClientRollupCard({ rows }: { rows: ClientPatchRollup[] }) {
  return (
    <Card title="Per-client posture">
      {rows.length === 0 ? <Empty>No clients reporting yet.</Empty> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <th style={th()}>Client</th>
              <th style={th()}>Devices</th>
              <th style={th()}>Patched</th>
              <th style={th()}>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.clientName} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <td style={td()}><strong>{r.clientName}</strong></td>
                <td style={td()}>{r.deviceCount}</td>
                <td style={td()}>{r.fullyPatched}</td>
                <td style={td()}>{r.patchedPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function DevicesNeedingCard({ rows }: { rows: DevicePatchRow[] }) {
  return (
    <Card title={`Hosts needing attention · ${rows.length}`}>
      {rows.length === 0 ? <Empty>All hosts current.</Empty> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <th style={th()}>Host</th>
              <th style={th()}>Pending</th>
              <th style={th()}>Failed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.device.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <td style={td()}>
                  <Link href={`/devices/${r.device.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                    {r.device.hostname}
                  </Link>
                </td>
                <td style={td()}>{r.pending}</td>
                <td style={td()}>{r.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function StaleCheckInCard({ rows }: { rows: StaleCheckInRow[] }) {
  return (
    <Card title={`Stale check-in · ${rows.length}`}>
      {rows.length === 0 ? <Empty>No stale hosts.</Empty> : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => (
            <li key={r.device.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "0.5px dashed var(--color-border-tertiary)" }}>
              <Link href={`/devices/${r.device.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                {r.device.hostname}
              </Link>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{r.ageDays ?? "?"}d ago</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", lineHeight: 1.55 }}>{children}</div>
}
function th(): React.CSSProperties {
  return { textAlign: "left", padding: "8px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "8px 10px", color: "var(--color-text-primary)", verticalAlign: "top" }
}
