import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import ActivityFeed from "@/components/ActivityFeed"
import SeedBanner from "@/components/SeedBanner"
import MaintenanceModeButton from "@/components/MaintenanceModeButton"
import { prisma } from "@/lib/prisma"
import { getDevice, getDeviceActivity, getDeviceAlerts, getDeviceScriptRuns, listDevices, relativeLastSeen } from "@/lib/devices"
import type { DeviceAlert, DeviceRow, DeviceScriptRun } from "@/lib/devices"

export const dynamic = "force-dynamic"

const TABS = [
  { id: "summary",  label: "Summary",  phase: null as string | null },
  { id: "system",   label: "System",   phase: null },
  { id: "patches",  label: "Patches",  phase: "Phase 4" },
  { id: "scripts",  label: "Scripts",  phase: "Phase 2" },
  { id: "software", label: "Software", phase: "Phase 3" },
  { id: "network",  label: "Network",  phase: null },
  { id: "activity", label: "Activity", phase: null },
  { id: "alerts",   label: "Alerts",   phase: null },
] as const
type TabId = typeof TABS[number]["id"]

export default async function DeviceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? "summary")

  const device = await getDevice(id)
  if (!device) notFound()

  const [alerts, activity, scriptRuns, fleet, maint] = await Promise.all([
    getDeviceAlerts(id),
    getDeviceActivity(id, 30),
    getDeviceScriptRuns(id, 20),
    listDevices(),
    prisma.fl_Device
      .findUnique({
        where: { id },
        select: { maintenanceMode: true, maintenanceUntil: true, maintenanceReason: true },
      })
      .catch(() => null),
  ])
  const fleetSize = fleet.rows.length
  const fleetAppCounts = new Map<string, number>()
  for (const d of fleet.rows) {
    for (const name of d.inventory?.software.sample ?? []) {
      fleetAppCounts.set(name, (fleetAppCounts.get(name) ?? 0) + 1)
    }
  }

  return (
    <AppShell openAlertsCount={alerts.filter((a) => a.state === "open").length}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Breadcrumb device={device} />
        <Header device={device} alertCount={alerts.filter((a) => a.state === "open").length} />
        {device.isMock && <SeedBanner kind="device" />}
        <ActionBar
          deviceId={device.id}
          maintenance={{
            on: maint?.maintenanceMode ?? false,
            until: maint?.maintenanceUntil ? maint.maintenanceUntil.toISOString() : null,
            reason: maint?.maintenanceReason ?? null,
          }}
        />
        <TabNav active={tab} deviceId={device.id} />
        {tab === "summary"  && <SummaryTab device={device} alerts={alerts} />}
        {tab === "system"   && <SystemTab device={device} />}
        {tab === "alerts"   && <AlertsTab alerts={alerts} />}
        {tab === "activity" && <ActivityFeed items={activity} title="Device activity" />}
        {tab === "patches"  && <PatchesTab device={device} />}
        {tab === "scripts"  && <ScriptsTab runs={scriptRuns} />}
        {tab === "software" && <SoftwareTab device={device} fleetSize={fleetSize} fleetAppCounts={fleetAppCounts} />}
        {tab === "network"  && <NetworkTab device={device} />}
      </div>
    </AppShell>
  )
}

function Breadcrumb({ device }: { device: DeviceRow }) {
  return (
    <nav style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>
      <Link href="/devices" style={{ color: "var(--color-text-secondary)", textDecoration: "none" }}>
        Devices
      </Link>
      <span style={{ margin: "0 6px" }}>›</span>
      <Link
        href={`/devices?client=${encodeURIComponent(device.clientName)}`}
        style={{ color: "var(--color-text-secondary)", textDecoration: "none" }}
      >
        {device.clientName}
      </Link>
      <span style={{ margin: "0 6px" }}>›</span>
      <span style={{ color: "var(--color-text-primary)", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
        {device.hostname}
      </span>
    </nav>
  )
}

function Header({ device, alertCount }: { device: DeviceRow; alertCount: number }) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
      <h1 style={{ fontSize: "22px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", gap: "10px" }}>
        <span
          aria-label={device.isOnline ? "online" : "offline"}
          title={device.isOnline ? "online" : "offline"}
          style={{
            display: "inline-block",
            width: "9px",
            height: "9px",
            borderRadius: "999px",
            background: device.isOnline ? "var(--color-success)" : "var(--color-text-muted)",
          }}
        />
        {device.hostname}
      </h1>
      <Pill text={device.clientName} />
      {device.os && <Pill text={device.os} mono />}
      {device.role && <Pill text={device.role} />}
      {device.ipAddress && <Pill text={device.ipAddress} mono />}
      {alertCount > 0 && (
        <Link
          href={`/devices/${device.id}?tab=alerts`}
          style={{
            padding: "2px 9px",
            borderRadius: "999px",
            fontSize: "11px",
            fontWeight: 600,
            background: "var(--color-warning-soft, rgba(234, 179, 8, 0.15))",
            color: "var(--color-warning)",
            textDecoration: "none",
          }}
        >
          {alertCount} alert{alertCount === 1 ? "" : "s"}
        </Link>
      )}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
        last seen {relativeLastSeen(device.lastSeenAt)}
      </span>
    </header>
  )
}

function Pill({ text, mono }: { text: string; mono?: boolean }) {
  return (
    <span
      style={{
        padding: "2px 9px",
        borderRadius: "999px",
        fontSize: "11px",
        background: "var(--color-background-tertiary)",
        color: "var(--color-text-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        fontFamily: mono ? "ui-monospace, SFMono-Regular, monospace" : undefined,
      }}
    >
      {text}
    </span>
  )
}

function ActionBar({
  deviceId,
  maintenance,
}: {
  deviceId: string
  maintenance: { on: boolean; until: string | null; reason: string | null }
}) {
  // Per UI-PATTERNS.md #1: "Big visible action bar at the top." Phase 3
  // ships Maintenance Mode as the first live action; the rest still
  // phase-tooltipped until their feature ships.
  const actions = [
    { label: "Remote",     phase: "Phase 4" },
    { label: "Quick Job",  phase: "Phase 2" },
    { label: "Patch Now",  phase: "Phase 4" },
    { label: "Reboot",     phase: "Phase 2" },
    { label: "Run script", phase: "Phase 2" },
    { label: "More ⋯",     phase: "Phase 1+" },
  ]
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        alignItems: "flex-start",
        padding: "10px 12px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
      }}
    >
      <MaintenanceModeButton
        deviceId={deviceId}
        isOn={maintenance.on}
        until={maintenance.until}
        reason={maintenance.reason}
      />
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          disabled
          title={`${a.label} ships in ${a.phase}`}
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 500,
            borderRadius: "6px",
            border: "0.5px solid var(--color-border-tertiary)",
            background: "transparent",
            color: "var(--color-text-muted)",
            cursor: "not-allowed",
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

function TabNav({ active, deviceId }: { active: TabId; deviceId: string }) {
  return (
    <nav style={{ display: "flex", gap: "2px", borderBottom: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap" }}>
      {TABS.map((t) => {
        const isActive = t.id === active
        return (
          <Link
            key={t.id}
            href={t.id === "summary" ? `/devices/${deviceId}` : `/devices/${deviceId}?tab=${t.id}`}
            style={{
              padding: "8px 14px",
              fontSize: "12px",
              color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontWeight: isActive ? 600 : 400,
              borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: "-0.5px",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {t.label}
            {t.phase && (
              <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "999px", background: "var(--color-background-tertiary)", color: "var(--color-text-muted)", border: "0.5px solid var(--color-border-tertiary)" }}>
                {t.phase}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

function SummaryTab({ device, alerts }: { device: DeviceRow; alerts: DeviceAlert[] }) {
  const inv = device.inventory
  const openAlerts = alerts.filter((a) => a.state === "open").slice(0, 3)
  return (
    <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Card title="Health (7-day average)">
          {inv ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
              <Gauge label="CPU"  pct={inv.health.cpu7d} />
              <Gauge label="RAM"  pct={inv.health.ramPct} />
              <Gauge label="Disk" pct={inv.health.diskPct} />
            </div>
          ) : (
            <Empty>No inventory snapshot yet — agent has not reported since enrollment.</Empty>
          )}
        </Card>
        <Card title="Hardware">
          {inv ? (
            <KVGrid pairs={[
              ["Make / Model", `${inv.hardware.manufacturer} · ${inv.hardware.model}`],
              ["CPU",          inv.hardware.cpu],
              ["RAM",          `${inv.hardware.ramGb} GB`],
              ["Disk",         `${inv.hardware.diskFreeGb} GB free of ${inv.hardware.diskGb} GB`],
              ["Serial",       inv.hardware.serial],
              ["BIOS",         `${inv.hardware.biosVersion} (${inv.hardware.biosDate})`],
              ["Purchased",    inv.hardware.purchaseDate],
            ]} />
          ) : <Empty>No hardware data.</Empty>}
        </Card>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Card title="Patch status">
          {inv ? (
            <KVGrid pairs={[
              ["Pending",      String(inv.patches.pending)],
              ["Failed",       String(inv.patches.failed)],
              ["Last checked", relativeLastSeen(new Date(inv.patches.lastChecked))],
            ]} />
          ) : <Empty>No patch data.</Empty>}
        </Card>
        <Card title={`Open alerts${openAlerts.length ? ` · ${openAlerts.length}` : ""}`}>
          {openAlerts.length === 0 ? (
            <Empty>No open alerts. ✨</Empty>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
              {openAlerts.map((a) => <AlertRow key={a.id} alert={a} compact />)}
              {alerts.length > openAlerts.length && (
                <li>
                  <Link href={`/devices/${device.id}?tab=alerts`} style={{ fontSize: "11px", color: "var(--color-text-secondary)", textDecoration: "underline" }}>
                    See all {alerts.length} alerts →
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Card>
        <Card title="OS">
          {inv ? (
            <KVGrid pairs={[
              ["Family",     inv.os.family],
              ["Version",    inv.os.version],
              ["Build",      inv.os.build],
              ["Installed",  inv.os.installedAt.slice(0, 10)],
              ["Last boot",  relativeLastSeen(new Date(inv.os.lastBootAt))],
              ["Timezone",   inv.os.timezone],
            ]} />
          ) : <Empty>No OS data.</Empty>}
        </Card>
      </div>
    </div>
  )
}

function SystemTab({ device }: { device: DeviceRow }) {
  const inv = device.inventory
  if (!inv) {
    return (
      <Card title="System">
        <Empty>No inventory snapshot. The agent reports this on enrollment + periodically; see <code>inventory.collect</code> in the agent protocol doc.</Empty>
      </Card>
    )
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card title="Hardware">
        <KVGrid pairs={[
          ["Manufacturer",   inv.hardware.manufacturer],
          ["Model",          inv.hardware.model],
          ["Serial number",  inv.hardware.serial],
          ["CPU",            inv.hardware.cpu],
          ["RAM",            `${inv.hardware.ramGb} GB`],
          ["Disk total",     `${inv.hardware.diskGb} GB`],
          ["Disk free",      `${inv.hardware.diskFreeGb} GB`],
          ["BIOS version",   inv.hardware.biosVersion],
          ["BIOS date",      inv.hardware.biosDate],
          ["Purchase date",  inv.hardware.purchaseDate],
        ]} />
      </Card>
      <Card title="Operating system">
        <KVGrid pairs={[
          ["Family",     inv.os.family],
          ["Version",    inv.os.version],
          ["Build",      inv.os.build],
          ["Installed",  inv.os.installedAt],
          ["Last boot",  inv.os.lastBootAt],
          ["Timezone",   inv.os.timezone],
        ]} />
      </Card>
    </div>
  )
}

function PatchesTab({ device }: { device: DeviceRow }) {
  const inv = device.inventory
  if (!inv) {
    return (
      <Card title="Patches · Phase 4">
        <Empty>No inventory snapshot yet — agent has not reported.</Empty>
      </Card>
    )
  }
  const lastChecked = new Date(inv.patches.lastChecked)
  const ageMs = Date.now() - lastChecked.getTime()
  const ageDays = Math.floor(ageMs / 86_400_000)
  const stale = ageDays > 7
  const fullyPatched = inv.patches.pending === 0 && inv.patches.failed === 0
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card title="Patch posture">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "12px" }}>
          <PostureTile label="Pending" value={String(inv.patches.pending)} tone={inv.patches.pending > 0 ? "warn" : "ok"} />
          <PostureTile label="Failed"  value={String(inv.patches.failed)}  tone={inv.patches.failed  > 0 ? "danger" : "ok"} />
          <PostureTile label="Last check" value={ageDays === 0 ? "today" : `${ageDays}d ago`} tone={stale ? "warn" : "neutral"} />
          <PostureTile label="Status" value={fullyPatched ? "Up to date" : "Updates available"} tone={fullyPatched ? "ok" : "warn"} />
        </div>
        <p style={{ fontSize: "11.5px", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.55 }}>
          Last checked {lastChecked.toISOString().slice(0, 16).replace("T", " ")} UTC.{" "}
          See <Link href="/patches" style={{ color: "var(--color-text-secondary)", textDecoration: "underline" }}>fleet-wide posture</Link>{" "}
          for cross-client rollouts and ring approvals.
        </p>
      </Card>
      <Card title="Phase 4 capabilities">
        <ul style={{ margin: 0, padding: "0 0 0 18px", color: "var(--color-text-secondary)", fontSize: "12.5px", lineHeight: 1.7 }}>
          <li>Per-KB list with severity, vendor, and supersedes chain</li>
          <li>Ring assignment (canary / wave 1 / wave 2) with halt-on-failure</li>
          <li>Deferral windows and per-host blackout overrides</li>
          <li>Force-install with reboot scheduling and pre-reboot warning</li>
          <li>Rollback for failed installs that pinned a known-bad KB</li>
        </ul>
      </Card>
    </div>
  )
}

function SoftwareTab({
  device,
  fleetSize,
  fleetAppCounts,
}: {
  device: DeviceRow
  fleetSize: number
  fleetAppCounts: Map<string, number>
}) {
  const inv = device.inventory
  if (!inv) {
    return (
      <Card title="Software · Phase 3">
        <Empty>No inventory snapshot yet — agent has not reported.</Empty>
      </Card>
    )
  }
  const enriched = inv.software.sample.map((name) => {
    const count = fleetAppCounts.get(name) ?? 0
    return { name, hostCount: count, pct: fleetSize === 0 ? 0 : Math.round((count / fleetSize) * 100) }
  })
  enriched.sort((a, b) => b.hostCount - a.hostCount || a.name.localeCompare(b.name))
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card title={`Installed software · ${inv.software.totalInstalled}`}>
        {enriched.length === 0 ? (
          <Empty>No software sample reported.</Empty>
        ) : (
          <>
            <p style={{ fontSize: "11.5px", color: "var(--color-text-muted)", margin: 0, marginBottom: "12px", lineHeight: 1.55 }}>
              Each app shows its prevalence across the fleet — useful
              for spotting outliers (one host running an app no one
              else has) and shared dependencies.
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
              {enriched.map((a) => (
                <li key={a.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                    <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{a.name}</span>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>
                      {a.hostCount}/{fleetSize} hosts · {a.pct}%
                    </span>
                  </div>
                  <div style={{ height: "4px", background: "var(--color-background-tertiary)", borderRadius: "999px", overflow: "hidden" }}>
                    <div style={{ width: `${a.pct}%`, height: "100%", background: "var(--color-accent)" }} />
                  </div>
                </li>
              ))}
            </ul>
            {inv.software.totalInstalled > inv.software.sample.length && (
              <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--color-text-muted)" }}>
                + {inv.software.totalInstalled - inv.software.sample.length} more — full list ships in Phase 3
              </div>
            )}
          </>
        )}
      </Card>
      <Card title="Phase 3 capabilities">
        <ul style={{ margin: 0, padding: "0 0 0 18px", color: "var(--color-text-secondary)", fontSize: "12.5px", lineHeight: 1.7 }}>
          <li>Full installed-app list with version, install date, and source (winget / choco / brew / msi)</li>
          <li>One-click install / uninstall / upgrade with canary → wave rollout</li>
          <li>Per-app version pinning to keep known-good builds across the fleet</li>
          <li>Detect drift from per-client software baselines</li>
        </ul>
      </Card>
    </div>
  )
}

function NetworkTab({ device }: { device: DeviceRow }) {
  const inv = device.inventory
  if (!inv) {
    return (
      <Card title="Network">
        <Empty>No inventory snapshot yet — agent has not reported.</Empty>
      </Card>
    )
  }
  const { interfaces, listeningPorts, recentConnections } = inv.network
  const upCount = interfaces.filter((i) => i.up).length

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card title={`Interfaces · ${upCount}/${interfaces.length} up`}>
        {interfaces.length === 0 ? (
          <Empty>No interfaces reported.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Name</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>State</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Speed</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>MAC</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Addresses</th>
              </tr>
            </thead>
            <tbody>
              {interfaces.map((iface) => (
                <tr key={iface.name}>
                  <td style={{ padding: "8px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 500 }}>{iface.name}</td>
                  <td style={{ padding: "8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    <span style={{ color: iface.up ? "var(--color-success)" : "var(--color-text-muted)" }}>
                      {iface.up ? "● up" : "○ down"}
                    </span>
                  </td>
                  <td style={{ padding: "8px", borderBottom: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-muted)" }}>
                    {iface.speedMbps ? `${iface.speedMbps} Mbps` : "—"}
                  </td>
                  <td style={{ padding: "8px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px", color: "var(--color-text-muted)" }}>
                    {iface.mac || "—"}
                  </td>
                  <td style={{ padding: "8px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                    {(iface.ipv4 ?? []).map((ip) => <div key={ip}>{ip}</div>)}
                    {(iface.ipv6 ?? []).map((ip) => <div key={ip} style={{ color: "var(--color-text-muted)" }}>{ip}</div>)}
                    {(iface.ipv4 ?? []).length === 0 && (iface.ipv6 ?? []).length === 0 && <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Listening ports · ${listeningPorts.length}`}>
        {listeningPorts.length === 0 ? (
          <Empty>No listening sockets reported. (Linux: ss not in PATH? Windows: PowerShell Get-NetTCPConnection access?)</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Proto</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Address</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Process</th>
              </tr>
            </thead>
            <tbody>
              {listeningPorts.map((p, i) => (
                <tr key={`${p.address}-${i}`}>
                  <td style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontFamily: "ui-monospace, SFMono-Regular, monospace", color: p.protocol === "tcp" ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>{p.protocol.toUpperCase()}</td>
                  <td style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{p.address}</td>
                  <td style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-muted)" }}>{p.process || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Recent connections · ${recentConnections.length}${recentConnections.length === 50 ? " (capped)" : ""}`}>
        {recentConnections.length === 0 ? (
          <Empty>No active outbound connections.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Proto</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Local</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>Remote</th>
                <th style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>State</th>
              </tr>
            </thead>
            <tbody>
              {recentConnections.map((c, i) => (
                <tr key={`${c.local}-${c.remote}-${i}`}>
                  <td style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{c.protocol.toUpperCase()}</td>
                  <td style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{c.local}</td>
                  <td style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{c.remote}</td>
                  <td style={{ padding: "6px 8px", borderBottom: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-muted)" }}>{c.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function ScriptsTab({ runs }: { runs: DeviceScriptRun[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card title={`Recent script runs${runs.length ? ` · ${runs.length}` : ""}`}>
        {runs.length === 0 ? (
          <Empty>
            No script runs yet on this host.{" "}
            <Link href="/scripts" style={{ color: "var(--color-text-secondary)", textDecoration: "underline" }}>
              Browse the script library
            </Link>{" "}
            — execution against live hosts ships in Phase 2.
          </Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
            <thead>
              <tr style={thHeadRow}>
                <th style={thStyle}>Script</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Exit</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>By</th>
                <th style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <td style={tdStyle}>
                    <span style={{ color: "var(--color-text-primary)", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                      {r.scriptName ?? r.scriptId}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <ScriptStatePill state={r.state} />
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: "11px", color: r.exitCode === 0 ? "var(--color-success)" : r.exitCode == null ? "var(--color-text-muted)" : "var(--color-danger)" }}>
                      {r.exitCode == null ? "—" : r.exitCode}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: "11px", color: r.dryRun ? "var(--color-text-muted)" : "var(--color-text-secondary)" }}>
                      {r.dryRun ? "dry-run" : "live"}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{r.initiatedBy ?? "scheduled"}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                      {relativeLastSeen(r.createdAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Phase 2 capabilities">
        <ul style={{ margin: 0, padding: "0 0 0 18px", color: "var(--color-text-secondary)", fontSize: "12.5px", lineHeight: 1.7 }}>
          <li>Run-once and scheduled jobs against this host</li>
          <li>Dry-run by default; tech opts in to live execution</li>
          <li>Signed-script enforcement — agent rejects unsigned bodies</li>
          <li>Truncated stdout inline + full output in object storage</li>
          <li>Halt + roll-back when a run errors above the configured threshold</li>
        </ul>
      </Card>
    </div>
  )
}

function ScriptStatePill({ state }: { state: DeviceScriptRun["state"] }) {
  const tone =
    state === "ok"        ? "var(--color-success)" :
    state === "running"   ? "var(--color-accent)" :
    state === "queued"    ? "var(--color-text-muted)" :
    state === "dryrun"    ? "var(--color-text-muted)" :
    state === "cancelled" ? "var(--color-text-muted)" :
                            "var(--color-danger)"
  return (
    <span style={{
      fontSize: "10.5px",
      padding: "1px 7px",
      borderRadius: "999px",
      background: "var(--color-background-tertiary)",
      color: tone,
      border: `0.5px solid ${tone}`,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      fontWeight: 600,
    }}>
      {state}
    </span>
  )
}

function PostureTile({ label, value, tone }: {
  label: string
  value: string
  tone: "neutral" | "ok" | "warn" | "danger"
}) {
  const color =
    tone === "danger" ? "var(--color-danger)" :
    tone === "warn"   ? "var(--color-warning)" :
    tone === "ok"     ? "var(--color-success)" :
                        "var(--color-text-primary)"
  return (
    <div style={{ padding: "8px 10px", background: "var(--color-background-tertiary)", borderRadius: "8px", border: "0.5px solid var(--color-border-tertiary)" }}>
      <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: "16px", fontWeight: 600, color, marginTop: "3px", lineHeight: 1.1 }}>{value}</div>
    </div>
  )
}

function AlertsTab({ alerts }: { alerts: DeviceAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Card title="Alerts">
        <Empty>No alerts on record for this device.</Empty>
      </Card>
    )
  }
  return (
    <Card title={`Alerts · ${alerts.length}`}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
        {alerts.map((a) => <AlertRow key={a.id} alert={a} />)}
      </ul>
    </Card>
  )
}

function AlertRow({ alert, compact }: { alert: DeviceAlert; compact?: boolean }) {
  const tone =
    alert.severity === "critical" ? "var(--color-danger)" :
    alert.severity === "warn"     ? "var(--color-warning)" :
                                    "var(--color-text-muted)"
  return (
    <li style={{ display: "flex", gap: "10px", padding: compact ? "0" : "8px 0", borderBottom: compact ? "none" : "0.5px dashed var(--color-border-tertiary)" }}>
      <span
        aria-label={alert.severity}
        style={{
          marginTop: "5px",
          width: "6px",
          height: "6px",
          borderRadius: "999px",
          background: tone,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12.5px", fontWeight: 500, color: "var(--color-text-primary)" }}>{alert.title}</span>
          <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "10.5px", color: "var(--color-text-muted)" }}>{alert.kind}</code>
          <span style={{ fontSize: "10.5px", color: "var(--color-text-muted)" }}>· {relativeLastSeen(alert.createdAt)}</span>
          {alert.state !== "open" && (
            <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "999px", background: "var(--color-background-tertiary)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {alert.state}
            </span>
          )}
        </div>
        {alert.detail && !compact && (
          <div style={{ fontSize: "11.5px", color: "var(--color-text-secondary)", marginTop: "3px" }}>
            {alert.detail}
          </div>
        )}
      </div>
    </li>
  )
}

function PhaseStub({ label, phase, hint }: { label: string; phase: string; hint: string }) {
  return (
    <Card title={`${label} · ${phase}`}>
      <Empty>{hint}</Empty>
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

function KVGrid({ pairs }: { pairs: Array<[string, string]> }) {
  return (
    <dl
      style={{
        margin: 0,
        display: "grid",
        gridTemplateColumns: "minmax(120px, 28%) 1fr",
        rowGap: "8px",
        columnGap: "16px",
        fontSize: "12.5px",
      }}
    >
      {pairs.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ color: "var(--color-text-muted)", fontSize: "11.5px" }}>{k}</dt>
          <dd style={{ margin: 0, color: "var(--color-text-primary)", wordBreak: "break-word" }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Gauge({ label, pct }: { label: string; pct: number }) {
  const tone = pct >= 85 ? "var(--color-danger)" : pct >= 65 ? "var(--color-warning)" : "var(--color-success)"
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          {label}
        </span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: tone }}>{pct}%</span>
      </div>
      <div
        style={{
          marginTop: "6px",
          height: "5px",
          width: "100%",
          background: "var(--color-background-tertiary)",
          borderRadius: "999px",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: tone, borderRadius: "999px" }} />
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)", lineHeight: 1.55 }}>{children}</div>
  )
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
