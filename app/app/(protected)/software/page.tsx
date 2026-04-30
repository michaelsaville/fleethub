import Link from "next/link"
import AppShell from "@/components/AppShell"
import SeedBanner from "@/components/SeedBanner"
import { mockMode } from "@/lib/devices"
import {
  getFleetSoftwarePosture,
  getHeavyHosts,
  getPerClientSoftware,
  getTopApps,
} from "@/lib/software"
import type {
  ClientSoftwareRollup,
  FleetSoftwarePosture,
  HeavyHostRow,
  TopAppRow,
} from "@/lib/software"

export const dynamic = "force-dynamic"

/**
 * Phase 3 software UI built mock-first off `inventory.software`.
 * Read-only today: deployment, uninstall, and version-pin actions
 * ship in Phase 3 with phase-tooltipped placeholders here per
 * UI-PATTERNS #8.
 */
export default async function SoftwarePage() {
  const [posture, topApps, perClient, heavyHosts, isMock] = await Promise.all([
    getFleetSoftwarePosture(),
    getTopApps(12),
    getPerClientSoftware(),
    getHeavyHosts(10),
    mockMode(),
  ])

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Software
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: "640px" }}>
              Installed software inventory across the fleet, derived
              from the per-host snapshot. Catalog-driven deployment
              (winget / choco / Homebrew) ships in Phase 3 — the
              ranking and prevalence shown here is what the deploy
              picker will operate on.
            </p>
          </div>
          <ActionButtons />
        </header>

        {isMock && <SeedBanner kind="fleet" />}

        <PostureStrip posture={posture} />

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "16px" }}>
          <TopAppsCard rows={topApps} totalDevices={posture.devices} />
          <HeavyHostsCard rows={heavyHosts} />
        </div>

        <ClientRollupCard rows={perClient} />

        <DeployModelCard />
      </div>
    </AppShell>
  )
}

function ActionButtons() {
  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <button type="button" disabled title="Catalog-driven deploy ships in Phase 3" style={btnStyle()}>
        Deploy app…
      </button>
      <button type="button" disabled title="Version-pin policy ships in Phase 3" style={btnStyle()}>
        Pin version…
      </button>
    </div>
  )
}

function btnStyle(): React.CSSProperties {
  return {
    fontSize: "12px",
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: "6px",
    border: "0.5px solid var(--color-border-tertiary)",
    background: "transparent",
    color: "var(--color-text-muted)",
    cursor: "not-allowed",
  }
}

function PostureStrip({ posture }: { posture: FleetSoftwarePosture }) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "8px",
      }}
    >
      <Tile label="Devices" value={String(posture.devices)} hint="reporting" />
      <Tile label="Total installs" value={String(posture.totalInstalls)} hint="across fleet" />
      <Tile label="Unique apps seen" value={String(posture.uniqueAppsSeen)} hint="from samples" />
      <Tile label="Avg per host" value={String(posture.avgPerHost)} hint="installs" />
    </section>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "8px",
      }}
    >
      <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--color-text-primary)", lineHeight: 1.1, marginTop: "4px" }}>
        {value}
      </div>
      <div style={{ fontSize: "10.5px", color: "var(--color-text-muted)", marginTop: "3px" }}>{hint}</div>
    </div>
  )
}

function TopAppsCard({ rows, totalDevices }: { rows: TopAppRow[]; totalDevices: number }) {
  return (
    <Card title={`Top installed apps${rows.length ? ` · ${rows.length}` : ""}`}>
      {rows.length === 0 ? (
        <Empty>No software samples yet — fills in once agents enroll and report inventory.</Empty>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map((r) => (
            <li key={r.name}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{r.name}</span>
                <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>
                  {r.hostCount}/{totalDevices} · {r.pct}%
                </span>
              </div>
              <div style={{ height: "5px", background: "var(--color-background-tertiary)", borderRadius: "999px", overflow: "hidden" }}>
                <div style={{ width: `${r.pct}%`, height: "100%", background: "var(--color-accent)" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function HeavyHostsCard({ rows }: { rows: HeavyHostRow[] }) {
  return (
    <Card title={`Most software per host${rows.length ? ` · ${rows.length}` : ""}`}>
      {rows.length === 0 ? (
        <Empty>No install counts yet.</Empty>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
          {rows.map((r) => (
            <li
              key={r.device.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
                padding: "5px 0",
                borderBottom: "0.5px dashed var(--color-border-tertiary)",
              }}
            >
              <Link
                href={`/devices/${r.device.id}`}
                style={{
                  color: "var(--color-text-primary)",
                  textDecoration: "none",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontSize: "11.5px",
                }}
              >
                {r.device.hostname}
              </Link>
              <span style={{ fontSize: "11.5px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
                {r.totalInstalled}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ClientRollupCard({ rows }: { rows: ClientSoftwareRollup[] }) {
  return (
    <Card title="Per-client install footprint">
      {rows.length === 0 ? (
        <Empty>No clients reporting yet.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
          <thead>
            <tr style={thHeadRow}>
              <th style={thStyle}>Client</th>
              <th style={thStyle}>Devices</th>
              <th style={thStyle}>Total installs</th>
              <th style={thStyle}>Avg / host</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.clientName} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <td style={tdStyle}>
                  <Link href={`/clients/${encodeURIComponent(r.clientName)}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                    {r.clientName}
                  </Link>
                </td>
                <td style={tdStyle}>{r.deviceCount}</td>
                <td style={tdStyle}>{r.totalInstalls}</td>
                <td style={tdStyle}>{r.avgPerHost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function DeployModelCard() {
  return (
    <Card title="Phase 3 deploy model">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
        <Channel label="winget" hint="Default for Windows. Microsoft-curated registry; pin major.minor." />
        <Channel label="choco" hint="Fallback for Windows apps not in winget. Signed packages only." />
        <Channel label="brew" hint="macOS deploys via Homebrew formulae and casks." />
      </div>
      <p style={{ fontSize: "11.5px", color: "var(--color-text-muted)", marginTop: "12px", marginBottom: 0, lineHeight: 1.55 }}>
        Same canary → wave → full pattern as patching. Per-app pinning
        keeps known-good versions; deploy attempts that fail their
        canary halt the rollout and surface an alert. Uninstall
        propagates with the same approval shape.
      </p>
    </Card>
  )
}

function Channel({ label, hint }: { label: string; hint: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--color-background-tertiary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "8px",
      }}
    >
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-primary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
        {label}
      </div>
      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: 1.45 }}>{hint}</div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "14px" }}>{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)", lineHeight: 1.55 }}>{children}</div>
}

const thHeadRow: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "10.5px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
}
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontWeight: 600,
}
const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
}
