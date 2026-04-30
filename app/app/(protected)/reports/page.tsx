import Link from "next/link"
import AppShell from "@/components/AppShell"
import SeedBanner from "@/components/SeedBanner"
import { getCompliance, getDiskPressure, getEolHosts, getFleetSnapshot, getLifecycle, getMemoryPressure, getOsDistribution, getStaleBoots } from "@/lib/reports"
import type { ComplianceRow, EolHostRow, LifecycleRow, OsDistributionRow, PressureRow } from "@/lib/reports"

export const dynamic = "force-dynamic"

/**
 * Phase 5 reports — but built mock-first off the same inventory
 * snapshot the agent will eventually fill. Each card is a
 * cross-cut over Fl_Device + Fl_Alert; nothing here needs real
 * agent data to be meaningful.
 *
 * Export-as-PDF and "schedule recurring" are stubbed with phase
 * tooltips because they depend on Phase 5's PDF service + cron, but
 * the queries that feed them are real today.
 */
export default async function ReportsPage() {
  const [snapshot, compliance, osDist, eol, lifecycle, disk, ram, boots] = await Promise.all([
    getFleetSnapshot(),
    getCompliance(),
    getOsDistribution(),
    getEolHosts(),
    getLifecycle(8),
    getDiskPressure(85),
    getMemoryPressure(80),
    getStaleBoots(30),
  ])

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Reports
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
              Cross-cut compliance and lifecycle reports derived from
              the latest inventory snapshot per host. Export-as-PDF and
              scheduled-export ship in Phase 5; the queries are real today.
            </p>
          </div>
          <ExportButtons />
        </header>

        {snapshot.isMock && <SeedBanner kind="fleet" />}

        <SnapshotStrip snapshot={snapshot} />

        <ComplianceCard rows={compliance} />

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "16px" }}>
          <OsDistributionCard rows={osDist} totalDevices={snapshot.devices} />
          <EolCard rows={eol} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "16px" }}>
          <LifecycleCard rows={lifecycle} />
          <PressureCard
            title="Disk pressure (≥85%)"
            unit="%"
            rows={disk}
            empty="No devices over the disk threshold."
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "16px" }}>
          <PressureCard
            title="RAM pressure (≥80% 7d avg)"
            unit="%"
            rows={ram}
            empty="No devices over the memory threshold."
          />
          <PressureCard
            title="Stale boots (≥30 days uptime)"
            unit=""
            rows={boots}
            empty="All hosts rebooted within 30 days."
          />
        </div>
      </div>
    </AppShell>
  )
}

function ExportButtons() {
  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <button
        type="button"
        disabled
        title="PDF export ships in Phase 5"
        style={btnStyle(false)}
      >
        Export PDF
      </button>
      <button
        type="button"
        disabled
        title="Scheduled export ships in Phase 5"
        style={btnStyle(false)}
      >
        Schedule…
      </button>
    </div>
  )
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: "12px",
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: "6px",
    border: active ? "0.5px solid var(--color-accent)" : "0.5px solid var(--color-border-tertiary)",
    background: active ? "var(--color-accent)" : "transparent",
    color: active ? "white" : "var(--color-text-muted)",
    cursor: active ? "pointer" : "not-allowed",
  }
}

function SnapshotStrip({ snapshot }: { snapshot: { clients: number; devices: number; online: number; patched: number; alertFree: number } }) {
  const onlinePct  = snapshot.devices > 0 ? Math.round((snapshot.online    / snapshot.devices) * 100) : 0
  const patchedPct = snapshot.devices > 0 ? Math.round((snapshot.patched   / snapshot.devices) * 100) : 0
  const alertPct   = snapshot.devices > 0 ? Math.round((snapshot.alertFree / snapshot.devices) * 100) : 0
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "8px",
      }}
    >
      <Tile label="Clients"      value={String(snapshot.clients)} hint="active fleets" />
      <Tile label="Devices"      value={String(snapshot.devices)} hint="enrolled" />
      <Tile label="Online"       value={`${snapshot.online}/${snapshot.devices}`}    hint={`${onlinePct}%`}  tone={onlinePct  === 100 ? "ok" : "warn"} />
      <Tile label="Fully patched" value={`${snapshot.patched}/${snapshot.devices}`} hint={`${patchedPct}%`} tone={patchedPct === 100 ? "ok" : "warn"} />
      <Tile label="Alert-free"   value={`${snapshot.alertFree}/${snapshot.devices}`} hint={`${alertPct}%`}  tone={alertPct   === 100 ? "ok" : "warn"} />
    </section>
  )
}

function Tile({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: "neutral" | "ok" | "warn" }) {
  const color = tone === "warn" ? "var(--color-warning)" : tone === "ok" ? "var(--color-success)" : "var(--color-text-primary)"
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
      <div style={{ fontSize: "18px", fontWeight: 600, color, lineHeight: 1.1, marginTop: "4px" }}>
        {value}
      </div>
      <div style={{ fontSize: "10.5px", color: "var(--color-text-muted)", marginTop: "3px" }}>
        {hint}
      </div>
    </div>
  )
}

function ComplianceCard({ rows }: { rows: ComplianceRow[] }) {
  return (
    <Card title="Compliance by client">
      {rows.length === 0 ? (
        <Empty>No clients yet — compliance fills in as agents enroll.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
          <thead>
            <tr style={thHeadRow}>
              <th style={thStyle}>Client</th>
              <th style={thStyle}>Devices</th>
              <th style={thStyle}>Online</th>
              <th style={thStyle}>Patched</th>
              <th style={thStyle}>Alert-free</th>
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
                <td style={tdStyle}><PctBar pct={r.onlinePct}    label={`${r.onlineCount}/${r.deviceCount}`} /></td>
                <td style={tdStyle}><PctBar pct={r.patchedPct}   label={`${r.patchedCount}/${r.deviceCount}`} /></td>
                <td style={tdStyle}><PctBar pct={r.alertFreePct} label={`${r.alertFreeCount}/${r.deviceCount}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function PctBar({ pct, label }: { pct: number; label: string }) {
  const tone = pct === 100 ? "var(--color-success)" : pct >= 80 ? "var(--color-warning)" : "var(--color-danger)"
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "120px" }}>
      <div style={{ flex: 1, height: "5px", background: "var(--color-background-tertiary)", borderRadius: "999px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: tone }} />
      </div>
      <span style={{ fontSize: "11px", color: tone, fontWeight: 600, whiteSpace: "nowrap", minWidth: "60px", textAlign: "right" }}>
        {pct}% · {label}
      </span>
    </div>
  )
}

function OsDistributionCard({ rows, totalDevices }: { rows: OsDistributionRow[]; totalDevices: number }) {
  return (
    <Card title="OS distribution">
      {rows.length === 0 ? (
        <Empty>No OS data — populates with first inventory.report.</Empty>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map((r) => (
            <li key={r.family}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px", color: "var(--color-text-primary)" }}>
                  {r.family}
                </code>
                <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>
                  {r.count}/{totalDevices} · {r.pct}%
                </span>
              </div>
              <div style={{ height: "5px", background: "var(--color-background-tertiary)", borderRadius: "999px", overflow: "hidden" }}>
                <div style={{ width: `${r.pct}%`, height: "100%", background: "var(--color-accent)" }} />
              </div>
              {r.versions.length > 0 && (
                <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
                  {r.versions.slice(0, 3).map((v) => (
                    <li key={v.version} style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: "var(--color-text-muted)" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: "8px" }}>{v.version}</span>
                      <span>{v.count}</span>
                    </li>
                  ))}
                  {r.versions.length > 3 && (
                    <li style={{ fontSize: "10.5px", color: "var(--color-text-muted)" }}>
                      + {r.versions.length - 3} more
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function EolCard({ rows }: { rows: EolHostRow[] }) {
  return (
    <Card title={`EOL OS inventory${rows.length ? ` · ${rows.length}` : ""}`}>
      {rows.length === 0 ? (
        <Empty>No hosts on EOL operating systems. ✨</Empty>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
          {rows.map((r) => (
            <li key={r.device.id} style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "6px 0", borderBottom: "0.5px dashed var(--color-border-tertiary)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <Link href={`/devices/${r.device.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                  {r.device.hostname}
                </Link>
                <Link href={`/clients/${encodeURIComponent(r.device.clientName)}`} style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontSize: "11px" }}>
                  {r.device.clientName}
                </Link>
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-warning)" }}>{r.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function LifecycleCard({ rows }: { rows: LifecycleRow[] }) {
  return (
    <Card title="Hardware lifecycle (oldest first)">
      {rows.length === 0 ? (
        <Empty>No hardware purchase data.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
          <thead>
            <tr style={thHeadRow}>
              <th style={thStyle}>Device</th>
              <th style={thStyle}>Model</th>
              <th style={thStyle}>Age</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.device.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <td style={tdStyle}>
                  <Link href={`/devices/${r.device.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                    {r.device.hostname}
                  </Link>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: "var(--color-text-secondary)" }}>{r.device.inventory!.hardware.model}</span>
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <span style={{ fontSize: "11.5px", color: r.ageYears >= 5 ? "var(--color-warning)" : "var(--color-text-secondary)", fontWeight: r.ageYears >= 5 ? 600 : 400 }}>
                    {r.ageYears}y
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function PressureCard({
  title,
  rows,
  empty,
  unit,
}: {
  title: string
  rows: PressureRow[]
  empty: string
  unit: string
}) {
  return (
    <Card title={`${title}${rows.length ? ` · ${rows.length}` : ""}`}>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
          {rows.map((r) => (
            <li key={`${r.device.id}-${r.metric}`} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "4px 0", borderBottom: "0.5px dashed var(--color-border-tertiary)" }}>
              <Link href={`/devices/${r.device.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                {r.device.hostname}
              </Link>
              <span style={{ color: "var(--color-warning)", fontWeight: 600, fontSize: "11.5px" }}>
                {r.value}{unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
