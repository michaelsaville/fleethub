import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import ActivityFeed from "@/components/ActivityFeed"
import SeedBanner from "@/components/SeedBanner"
import { getDevice, getDeviceActivity, getDeviceAlerts, relativeLastSeen } from "@/lib/devices"
import type { DeviceAlert, DeviceRow } from "@/lib/devices"

export const dynamic = "force-dynamic"

const TABS = [
  { id: "summary",  label: "Summary",  phase: null as string | null },
  { id: "system",   label: "System",   phase: null },
  { id: "patches",  label: "Patches",  phase: "Phase 4" },
  { id: "scripts",  label: "Scripts",  phase: "Phase 2" },
  { id: "software", label: "Software", phase: "Phase 3" },
  { id: "network",  label: "Network",  phase: "Phase 1.5" },
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

  const [alerts, activity] = await Promise.all([
    getDeviceAlerts(id),
    getDeviceActivity(id, 30),
  ])

  return (
    <AppShell openAlertsCount={alerts.filter((a) => a.state === "open").length}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Breadcrumb device={device} />
        <Header device={device} alertCount={alerts.filter((a) => a.state === "open").length} />
        {device.isMock && <SeedBanner kind="device" />}
        <ActionBar />
        <TabNav active={tab} deviceId={device.id} />
        {tab === "summary"  && <SummaryTab device={device} alerts={alerts} />}
        {tab === "system"   && <SystemTab device={device} />}
        {tab === "alerts"   && <AlertsTab alerts={alerts} />}
        {tab === "activity" && <ActivityFeed items={activity} title="Device activity" />}
        {tab === "patches"  && <PhaseStub label="Patches"  phase="Phase 4" hint="Pending KBs, deploy history, ring assignment, deferral status." />}
        {tab === "scripts"  && <PhaseStub label="Scripts"  phase="Phase 2" hint="Recent script runs scoped to this host, with output drill-in." />}
        {tab === "software" && <PhaseStub label="Software" phase="Phase 3" hint="Installed apps with version/source, install/uninstall/update buttons." />}
        {tab === "network"  && <PhaseStub label="Network"  phase="Phase 1.5" hint="Interface list, listening ports, recent connections." />}
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

function ActionBar() {
  // Per UI-PATTERNS.md #1: "Big visible action bar at the top." Phase 0
  // ships the bar with the buttons disabled + phase tooltips so the
  // affordance is built; later phases just plumb the click handlers.
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
        padding: "10px 12px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
      }}
    >
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
      <Card title={`Installed software · ${inv.software.totalInstalled}`}>
        <SoftwareSample sample={inv.software.sample} total={inv.software.totalInstalled} />
      </Card>
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

function SoftwareSample({ sample, total }: { sample: string[]; total: number }) {
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {sample.map((s) => (
          <span
            key={s}
            style={{
              padding: "2px 9px",
              borderRadius: "999px",
              fontSize: "11.5px",
              background: "var(--color-background-tertiary)",
              color: "var(--color-text-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
            }}
          >
            {s}
          </span>
        ))}
      </div>
      {total > sample.length && (
        <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--color-text-muted)" }}>
          + {total - sample.length} more — full list ships in Phase 3 (Software namespace)
        </div>
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)", lineHeight: 1.55 }}>{children}</div>
  )
}
