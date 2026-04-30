import Link from "next/link"
import AppShell from "@/components/AppShell"
import SeedBanner from "@/components/SeedBanner"
import { mockMode } from "@/lib/devices"
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

export const dynamic = "force-dynamic"

/**
 * Phase 4 patch UI built mock-first off the same inventory shape
 * the agent will fill. Read-only today: every action button is
 * disabled with a phase-tooltipped reason per UI-PATTERNS #8.
 */
export default async function PatchesPage() {
  const [posture, perClient, needingPatches, staleCheckIns, isMock] = await Promise.all([
    getFleetPatchPosture(),
    getPerClientPatchRollup(),
    getDevicesNeedingPatches(12),
    getStaleCheckIns(7),
    mockMode(),
  ])

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Patches
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: "640px" }}>
              Fleet-wide patch posture from the latest agent inventory
              snapshot. Approval rings, deferral windows, and
              halt-on-failure rollouts ship in Phase 4 — the data you
              see here is what they will operate on.
            </p>
          </div>
          <ActionButtons />
        </header>

        {isMock && <SeedBanner kind="fleet" />}

        <PostureStrip posture={posture} />

        <ClientRollupCard rows={perClient} />

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "16px" }}>
          <DevicesNeedingCard rows={needingPatches} />
          <StaleCheckInCard rows={staleCheckIns} />
        </div>

        <RolloutModelCard />
      </div>
    </AppShell>
  )
}

function ActionButtons() {
  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <button type="button" disabled title="Approval rings ship in Phase 4" style={btnStyle()}>
        New rollout…
      </button>
      <button type="button" disabled title="Deferral policy editor ships in Phase 4" style={btnStyle()}>
        Defer window…
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

function PostureStrip({ posture }: { posture: FleetPatchPosture }) {
  const patchedPct = posture.devices > 0 ? Math.round((posture.fullyPatched / posture.devices) * 100) : 0
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "8px",
      }}
    >
      <Tile label="Devices"        value={String(posture.devices)} hint="reporting" />
      <Tile label="Fully patched"  value={`${posture.fullyPatched}/${posture.devices}`} hint={`${patchedPct}%`} tone={patchedPct === 100 ? "ok" : "warn"} />
      <Tile label="Pending updates" value={String(posture.pendingTotal)} hint={`${posture.withPending} hosts`} tone={posture.withPending > 0 ? "warn" : "ok"} />
      <Tile label="Failed installs" value={String(posture.failedTotal)} hint={`${posture.withFailed} hosts`} tone={posture.failedTotal > 0 ? "danger" : "ok"} />
      <Tile label="Stale check-in"  value={String(posture.staleCheck)} hint=">7 days" tone={posture.staleCheck > 0 ? "warn" : "ok"} />
    </section>
  )
}

function Tile({ label, value, hint, tone = "neutral" }: {
  label: string
  value: string
  hint: string
  tone?: "neutral" | "ok" | "warn" | "danger"
}) {
  const color =
    tone === "danger" ? "var(--color-danger)" :
    tone === "warn"   ? "var(--color-warning)" :
    tone === "ok"     ? "var(--color-success)" :
                        "var(--color-text-primary)"
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
      <div style={{ fontSize: "10.5px", color: "var(--color-text-muted)", marginTop: "3px" }}>{hint}</div>
    </div>
  )
}

function ClientRollupCard({ rows }: { rows: ClientPatchRollup[] }) {
  return (
    <Card title="Per-client posture">
      {rows.length === 0 ? (
        <Empty>No clients reporting yet — fills in once agents enroll.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
          <thead>
            <tr style={thHeadRow}>
              <th style={thStyle}>Client</th>
              <th style={thStyle}>Devices</th>
              <th style={thStyle}>Patched</th>
              <th style={thStyle}>Pending</th>
              <th style={thStyle}>Failed</th>
              <th style={thStyle}>Stale</th>
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
                <td style={tdStyle}>
                  <PctBar pct={r.patchedPct} label={`${r.fullyPatched}/${r.deviceCount}`} />
                </td>
                <td style={tdStyle}>
                  {r.pendingTotal > 0 ? (
                    <span style={{ color: "var(--color-warning)", fontWeight: 600 }}>{r.pendingTotal}</span>
                  ) : (
                    <span style={{ color: "var(--color-text-muted)" }}>0</span>
                  )}
                </td>
                <td style={tdStyle}>
                  {r.failedTotal > 0 ? (
                    <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>{r.failedTotal}</span>
                  ) : (
                    <span style={{ color: "var(--color-text-muted)" }}>0</span>
                  )}
                </td>
                <td style={tdStyle}>
                  {r.staleCheck > 0 ? (
                    <span style={{ color: "var(--color-warning)" }}>{r.staleCheck}</span>
                  ) : (
                    <span style={{ color: "var(--color-text-muted)" }}>0</span>
                  )}
                </td>
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

function DevicesNeedingCard({ rows }: { rows: DevicePatchRow[] }) {
  return (
    <Card title={`Hosts needing attention${rows.length ? ` · ${rows.length}` : ""}`}>
      {rows.length === 0 ? (
        <Empty>No pending or failed updates across the fleet.</Empty>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
          <thead>
            <tr style={thHeadRow}>
              <th style={thStyle}>Host</th>
              <th style={thStyle}>Client</th>
              <th style={thStyle}>Pending</th>
              <th style={thStyle}>Failed</th>
              <th style={thStyle}>Last check</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.device.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <td style={tdStyle}>
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
                </td>
                <td style={tdStyle}>
                  <Link href={`/clients/${encodeURIComponent(r.device.clientName)}`} style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontSize: "11px" }}>
                    {r.device.clientName}
                  </Link>
                </td>
                <td style={tdStyle}>
                  {r.pending > 0 ? (
                    <span style={{ color: "var(--color-warning)", fontWeight: 600 }}>{r.pending}</span>
                  ) : (
                    <span style={{ color: "var(--color-text-muted)" }}>—</span>
                  )}
                </td>
                <td style={tdStyle}>
                  {r.failed > 0 ? (
                    <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>{r.failed}</span>
                  ) : (
                    <span style={{ color: "var(--color-text-muted)" }}>—</span>
                  )}
                </td>
                <td style={tdStyle}>
                  {r.lastCheckedAgeDays == null ? (
                    <span style={{ color: "var(--color-text-muted)" }}>never</span>
                  ) : (
                    <span style={{ color: r.lastCheckedAgeDays > 7 ? "var(--color-warning)" : "var(--color-text-secondary)", fontSize: "11.5px" }}>
                      {r.lastCheckedAgeDays === 0 ? "today" : `${r.lastCheckedAgeDays}d ago`}
                    </span>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <button
                    type="button"
                    disabled
                    title="Direct install ships in Phase 4"
                    style={{ ...btnStyle(), padding: "3px 8px", fontSize: "11px" }}
                  >
                    Install…
                  </button>
                </td>
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
    <Card title={`Stale check-ins${rows.length ? ` · ${rows.length}` : ""}`}>
      {rows.length === 0 ? (
        <Empty>Every host checked in within the last 7 days.</Empty>
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
              <span style={{ fontSize: "11px", color: "var(--color-warning)", fontWeight: 500 }}>
                {r.ageDays == null ? "never" : `${r.ageDays}d`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RolloutModelCard() {
  return (
    <Card title="Phase 4 rollout model">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
        <Ring label="Canary" pct="5%" hint="One device per client. Halt-on-failure aborts the wave." />
        <Ring label="Wave 1" pct="25%" hint="Bulk of devices once canary is clean for 24h." />
        <Ring label="Wave 2" pct="100%" hint="Remaining devices including critical/server roles." />
      </div>
      <p style={{ fontSize: "11.5px", color: "var(--color-text-muted)", marginTop: "12px", marginBottom: 0, lineHeight: 1.55 }}>
        Approval per ring with deferral windows (e.g. "no patches Mon
        9am–5pm") and per-host blackout overrides. Failed installs
        automatically pin and surface here as <em>Failed</em>; rollouts
        halt at the configured failure threshold per ring.
      </p>
    </Card>
  )
}

function Ring({ label, pct, hint }: { label: string; pct: string; hint: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--color-background-tertiary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "8px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-primary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-accent)" }}>{pct}</span>
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
