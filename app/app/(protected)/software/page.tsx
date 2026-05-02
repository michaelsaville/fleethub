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
import { computeDrift } from "@/lib/drift"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

type TabId = "drift" | "top" | "heavy" | "perclient" | "catalog"
const TABS: { id: TabId; label: string }[] = [
  { id: "drift", label: "Drift" },
  { id: "top", label: "Top apps" },
  { id: "heavy", label: "Heavy hosts" },
  { id: "perclient", label: "Per-client" },
  { id: "catalog", label: "Catalog" },
]

/**
 * Phase 3 software UI. Default tab flipped to **drift** — the highest-
 * value surface ("Chrome 122 across 44 hosts, 3 stuck on 119"). The
 * rollup tabs (top/heavy/per-client) stay as secondary surfaces.
 */
export default async function SoftwarePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const sp = await searchParams
  const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? "drift")
  const isMock = await mockMode()

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Software
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: "640px" }}>
              Drift between approved package versions and what's actually installed.
              Per-host inventory rolls up to the secondary tabs.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Link href="/packages" style={btnGhost()}>
              Packages →
            </Link>
            <Link href="/deployments/new" style={btnPrimary()}>
              Deploy app…
            </Link>
          </div>
        </header>

        {isMock && <SeedBanner kind="fleet" />}

        <nav style={{ display: "flex", gap: 2, borderBottom: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const active = t.id === tab
            return (
              <Link
                key={t.id}
                href={`/software?tab=${t.id}`}
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

        {tab === "drift" && <DriftTab />}
        {tab === "top" && <RollupTab kind="top" />}
        {tab === "heavy" && <RollupTab kind="heavy" />}
        {tab === "perclient" && <RollupTab kind="perclient" />}
        {tab === "catalog" && <CatalogTab />}
      </div>
    </AppShell>
  )
}

async function DriftTab() {
  // Compute drift across all known tenants. Single-tenant in v1, but
  // shaping for multi-tenant pivot later.
  const tenants = await prisma.fl_Device.findMany({
    select: { clientName: true },
    distinct: ["clientName"],
  })
  const allDrift = (
    await Promise.all(tenants.map((t) => computeDrift(t.clientName)))
  ).flat()

  if (allDrift.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--color-text-muted)", background: "var(--color-background-secondary)", border: "0.5px dashed var(--color-border-tertiary)", borderRadius: 10 }}>
        Add approved packages on{" "}
        <Link href="/packages" style={{ color: "var(--color-accent)" }}>
          /packages
        </Link>{" "}
        to compute drift against the fleet's installed-software inventory.
      </div>
    )
  }

  return (
    <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <th style={th()}>Package</th>
            <th style={th()}>OS</th>
            <th style={th()}>Approved</th>
            <th style={th()}>Versions in fleet</th>
            <th style={th()}>Up-to-date</th>
            <th style={th()}>Outdated</th>
            <th style={th()}>Unmanaged</th>
            <th style={th()}></th>
          </tr>
        </thead>
        <tbody>
          {allDrift.map((d) => {
            const versions = Object.entries(d.hostCountByVersion).sort((a, b) => b[1] - a[1])
            return (
              <tr key={d.packageId} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <td style={td()}>
                  <Link href={`/packages/${d.packageId}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                    {d.packageName}
                  </Link>
                </td>
                <td style={td()}>{d.os}</td>
                <td style={td()}><code>{d.approvedVersion ?? "—"}</code></td>
                <td style={td()}>
                  {versions.length === 0 ? (
                    <span style={{ color: "var(--color-text-muted)" }}>none</span>
                  ) : (
                    versions.map(([v, n]) => (
                      <span key={v} style={{ display: "inline-block", marginRight: 8, padding: "1px 6px", borderRadius: 4, fontSize: 11, background: v === d.approvedVersion ? "var(--color-success)" : "var(--color-background-tertiary)", color: v === d.approvedVersion ? "#fff" : "var(--color-text-primary)" }}>
                        <code>{v}</code>×{n}
                      </span>
                    ))
                  )}
                </td>
                <td style={td()}>
                  <span style={{ color: "var(--color-success)", fontWeight: 600 }}>
                    {d.upToDateDeviceIds.length}
                  </span>
                </td>
                <td style={td()}>
                  <span style={{ color: d.outdatedDeviceIds.length > 0 ? "var(--color-warn)" : "var(--color-text-muted)", fontWeight: 600 }}>
                    {d.outdatedDeviceIds.length}
                  </span>
                </td>
                <td style={td()}>
                  <span style={{ color: "var(--color-text-muted)" }}>{d.unmanagedDeviceIds.length}</span>
                </td>
                <td style={td()}>
                  {d.outdatedDeviceIds.length > 0 && (
                    <Link
                      href={`/deployments/new?packageId=${d.packageId}&targets=${d.outdatedDeviceIds.join(",")}`}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, background: "var(--color-accent)", color: "#fff", textDecoration: "none", fontWeight: 600 }}
                    >
                      Catch up →
                    </Link>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

async function RollupTab({ kind }: { kind: "top" | "heavy" | "perclient" }) {
  const [posture, topApps, perClient, heavyHosts] = await Promise.all([
    getFleetSoftwarePosture(),
    getTopApps(20),
    getPerClientSoftware(),
    getHeavyHosts(15),
  ])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PostureStrip posture={posture} />
      {kind === "top" && <TopAppsCard rows={topApps} totalDevices={posture.devices} />}
      {kind === "heavy" && <HeavyHostsCard rows={heavyHosts} />}
      {kind === "perclient" && <ClientRollupCard rows={perClient} />}
    </div>
  )
}

async function CatalogTab() {
  const packages = await prisma.fl_Package.findMany({
    where: { archivedAt: null },
    include: { versions: { orderBy: { createdAt: "desc" }, take: 3 } },
    orderBy: [{ tenantName: "asc" }, { name: "asc" }],
  })
  return (
    <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 14 }}>
      {packages.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          No packages yet. Visit{" "}
          <Link href="/packages" style={{ color: "var(--color-accent)" }}>
            /packages
          </Link>{" "}
          to add the first one.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
          {packages.map((p) => (
            <li key={p.id} style={{ padding: 10, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, background: "var(--color-background-tertiary)" }}>
              <Link href={`/packages/${p.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                {p.name}
              </Link>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                {p.source} · {p.os} · {p.versions[0]?.version ?? "no version"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PostureStrip({ posture }: { posture: FleetSoftwarePosture }) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
      <Tile label="Devices" value={String(posture.devices)} hint="reporting" />
      <Tile label="Total installs" value={String(posture.totalInstalls)} hint="across fleet" />
      <Tile label="Unique apps seen" value={String(posture.uniqueAppsSeen)} hint="from samples" />
      <Tile label="Avg per host" value={String(posture.avgPerHost)} hint="installs" />
    </section>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={{ padding: "10px 12px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "var(--color-text-primary)", lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 3 }}>{hint}</div>
    </div>
  )
}

function TopAppsCard({ rows, totalDevices }: { rows: TopAppRow[]; totalDevices: number }) {
  return (
    <Card title={`Top installed apps · ${rows.length}`}>
      {rows.length === 0 ? <Empty /> : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <li key={r.name}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{r.name}</span>
                <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>{r.hostCount}/{totalDevices} · {r.pct}%</span>
              </div>
              <div style={{ height: 5, background: "var(--color-background-tertiary)", borderRadius: 999, overflow: "hidden" }}>
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
    <Card title={`Most software per host · ${rows.length}`}>
      {rows.length === 0 ? <Empty /> : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => (
            <li key={r.device.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: "0.5px dashed var(--color-border-tertiary)" }}>
              <Link href={`/devices/${r.device.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                {r.device.hostname}
              </Link>
              <span style={{ fontSize: 11.5, color: "var(--color-text-secondary)", fontWeight: 600 }}>{r.totalInstalled}</span>
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
      {rows.length === 0 ? <Empty /> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <th style={th()}>Client</th>
              <th style={th()}>Devices</th>
              <th style={th()}>Total installs</th>
              <th style={th()}>Avg / host</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.clientName} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <td style={td()}><Link href={`/clients/${encodeURIComponent(r.clientName)}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>{r.clientName}</Link></td>
                <td style={td()}>{r.deviceCount}</td>
                <td style={td()}>{r.totalInstalls}</td>
                <td style={td()}>{r.avgPerHost}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function Empty() {
  return <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>No data yet.</div>
}

function btnGhost(): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 6, border: "0.5px solid var(--color-border-tertiary)", background: "transparent", color: "var(--color-text-secondary)", textDecoration: "none" }
}
function btnPrimary(): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: 6, background: "var(--color-accent)", color: "#fff", textDecoration: "none" }
}
function th(): React.CSSProperties {
  return { textAlign: "left", padding: "8px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "8px 10px", color: "var(--color-text-primary)", verticalAlign: "top" }
}
