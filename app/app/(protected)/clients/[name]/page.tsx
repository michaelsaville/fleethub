import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import ActivityFeed from "@/components/ActivityFeed"
import SeedBanner from "@/components/SeedBanner"
import { listAlerts } from "@/lib/alerts"
import { getClient, getClientActivity } from "@/lib/clients"
import { listDevices } from "@/lib/devices"
import { relativeLastSeen } from "@/lib/devices-time"
import type { AlertRow } from "@/lib/alerts"
import type { DeviceRow } from "@/lib/devices"

export const dynamic = "force-dynamic"

const TABS = [
  { id: "summary",  label: "Summary"  },
  { id: "devices",  label: "Devices"  },
  { id: "alerts",   label: "Alerts"   },
  { id: "activity", label: "Activity" },
] as const
type TabId = typeof TABS[number]["id"]

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { name: rawName } = await params
  const name = decodeURIComponent(rawName)
  const sp = await searchParams
  const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? "summary")

  const client = await getClient(name)
  if (!client) notFound()

  const [{ rows: devices }, { rows: alerts }, activity] = await Promise.all([
    listDevices({ client: name }),
    listAlerts({ client: name, state: "all" }),
    getClientActivity(name, 40),
  ])

  return (
    <AppShell openAlertsCount={client.openAlerts}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Breadcrumb name={name} />
        <Header name={name} client={client} />
        {client.isMock && <SeedBanner kind="fleet" />}

        <StatStrip client={client} />

        <TabNav active={tab} clientName={name} />

        {tab === "summary"  && <SummaryTab devices={devices} alerts={alerts} />}
        {tab === "devices"  && <DevicesTab devices={devices} />}
        {tab === "alerts"   && <AlertsTab alerts={alerts} />}
        {tab === "activity" && <ActivityFeed items={activity} title="Activity" />}
      </div>
    </AppShell>
  )
}

function Breadcrumb({ name }: { name: string }) {
  return (
    <nav style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>
      <Link href="/clients" style={{ color: "var(--color-text-secondary)", textDecoration: "none" }}>
        Clients
      </Link>
      <span style={{ margin: "0 6px" }}>›</span>
      <span style={{ color: "var(--color-text-primary)" }}>{name}</span>
    </nav>
  )
}

function Header({ name, client }: { name: string; client: { criticalAlerts: number; openAlerts: number } }) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
      <h1 style={{ fontSize: "22px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
        {name}
      </h1>
      {client.criticalAlerts > 0 && (
        <Link
          href={`/alerts?client=${encodeURIComponent(name)}&severity=critical`}
          style={{
            padding: "2px 9px",
            borderRadius: "999px",
            fontSize: "11px",
            fontWeight: 600,
            background: "var(--color-danger-soft, rgba(239, 68, 68, 0.15))",
            color: "var(--color-danger)",
            textDecoration: "none",
          }}
        >
          {client.criticalAlerts} critical
        </Link>
      )}
      <span style={{ flex: 1 }} />
      <a
        href={`https://dochub.pcc2k.com/clients/${encodeURIComponent(name)}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: "11px",
          color: "var(--color-text-secondary)",
          textDecoration: "none",
          padding: "5px 10px",
          borderRadius: "5px",
          border: "0.5px solid var(--color-border-secondary)",
          background: "transparent",
        }}
      >
        DocHub ↗
      </a>
    </header>
  )
}

function StatStrip({ client }: { client: { deviceCount: number; onlineCount: number; openAlerts: number; criticalAlerts: number; hostsBehindPatch: number; oldestPurchase: string | null; newestActivity: Date | null } }) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "8px",
      }}
    >
      <Tile label="Devices"        value={String(client.deviceCount)}                                                    hint="enrolled" />
      <Tile label="Online"         value={`${client.onlineCount}/${client.deviceCount}`}                                  hint={client.deviceCount > 0 ? `${Math.round((client.onlineCount / client.deviceCount) * 100)}%` : ""}  tone={client.onlineCount === client.deviceCount ? "ok" : "warn"} />
      <Tile label="Open alerts"    value={String(client.openAlerts)}                                                      hint={client.criticalAlerts > 0 ? `${client.criticalAlerts} critical` : "monitored"} tone={client.openAlerts > 0 ? "warn" : "ok"} />
      <Tile label="Hosts behind"   value={String(client.hostsBehindPatch)}                                                hint="patch coverage"                                                                            tone={client.hostsBehindPatch > 0 ? "warn" : "ok"} />
      <Tile label="Oldest hardware" value={client.oldestPurchase ? client.oldestPurchase.slice(0, 7) : "—"}                hint="purchase date" />
      <Tile label="Last activity"   value={client.newestActivity ? relativeLastSeen(client.newestActivity) : "never"}      hint="any host" />
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

function TabNav({ active, clientName }: { active: TabId; clientName: string }) {
  return (
    <nav style={{ display: "flex", gap: "2px", borderBottom: "0.5px solid var(--color-border-tertiary)", flexWrap: "wrap" }}>
      {TABS.map((t) => {
        const isActive = t.id === active
        const href = t.id === "summary"
          ? `/clients/${encodeURIComponent(clientName)}`
          : `/clients/${encodeURIComponent(clientName)}?tab=${t.id}`
        return (
          <Link
            key={t.id}
            href={href}
            style={{
              padding: "8px 14px",
              fontSize: "12px",
              color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontWeight: isActive ? 600 : 400,
              borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: "-0.5px",
              textDecoration: "none",
            }}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

function SummaryTab({ devices, alerts }: { devices: DeviceRow[]; alerts: AlertRow[] }) {
  const offline = devices.filter((d) => !d.isOnline)
  const openAlerts = alerts.filter((a) => a.state === "open").slice(0, 5)
  const oldest = [...devices]
    .filter((d) => d.inventory?.hardware.purchaseDate)
    .sort((a, b) => (a.inventory!.hardware.purchaseDate.localeCompare(b.inventory!.hardware.purchaseDate)))
    .slice(0, 3)

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Card title={`Open alerts${openAlerts.length ? ` · ${openAlerts.length}` : ""}`}>
          {openAlerts.length === 0 ? (
            <Empty>No open alerts. ✨</Empty>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
              {openAlerts.map((a) => (
                <li key={a.id} style={{ display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12.5px" }}>
                  <span
                    aria-label={a.severity}
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "999px",
                      flexShrink: 0,
                      marginTop: "5px",
                      background: a.severity === "critical" ? "var(--color-danger)" : a.severity === "warn" ? "var(--color-warning)" : "var(--color-text-muted)",
                    }}
                  />
                  <Link href={`/alerts/${a.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", flex: 1 }}>
                    {a.title}
                  </Link>
                  <span style={{ fontSize: "10.5px", color: "var(--color-text-muted)" }}>
                    {relativeLastSeen(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Offline devices${offline.length ? ` · ${offline.length}` : ""}`}>
          {offline.length === 0 ? (
            <Empty>All devices online.</Empty>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
              {offline.map((d) => (
                <li key={d.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", padding: "4px 0", borderBottom: "0.5px dashed var(--color-border-tertiary)" }}>
                  <Link href={`/devices/${d.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                    {d.hostname}
                  </Link>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    last seen {relativeLastSeen(d.lastSeenAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Card title="Hardware lifecycle">
          {oldest.length === 0 ? (
            <Empty>No hardware purchase dates available.</Empty>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "12.5px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {oldest.map((d) => (
                <li key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "0.5px dashed var(--color-border-tertiary)" }}>
                  <Link href={`/devices/${d.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none" }}>
                    {d.inventory!.hardware.model}
                  </Link>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    {d.inventory!.hardware.purchaseDate}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function DevicesTab({ devices }: { devices: DeviceRow[] }) {
  if (devices.length === 0) return <Card title="Devices"><Empty>No devices.</Empty></Card>
  return (
    <Card title={`Devices · ${devices.length}`}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ color: "var(--color-text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <th style={thStyle}>Host</th>
            <th style={thStyle}>OS</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>IP</th>
            <th style={thStyle}>Last seen</th>
            <th style={thStyle}>Alerts</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
              <td style={tdStyle}>
                <Link href={`/devices/${d.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "7px",
                      height: "7px",
                      borderRadius: "999px",
                      marginRight: "8px",
                      background: d.isOnline ? "var(--color-success)" : "var(--color-text-muted)",
                      verticalAlign: "middle",
                    }}
                  />
                  {d.hostname}
                </Link>
              </td>
              <td style={tdStyle}><code style={codeStyle}>{d.os ?? "—"}</code></td>
              <td style={tdStyle}>{d.role ?? "—"}</td>
              <td style={{ ...tdStyle, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>{d.ipAddress ?? "—"}</td>
              <td style={tdStyle}>{relativeLastSeen(d.lastSeenAt)}</td>
              <td style={tdStyle}>
                {d.alertCount > 0 ? (
                  <span style={{ padding: "1px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, background: "var(--color-warning-soft, rgba(234, 179, 8, 0.15))", color: "var(--color-warning)" }}>
                    {d.alertCount}
                  </span>
                ) : (
                  <span style={{ color: "var(--color-text-muted)" }}>0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function AlertsTab({ alerts }: { alerts: AlertRow[] }) {
  if (alerts.length === 0) return <Card title="Alerts"><Empty>No alerts on record for this client.</Empty></Card>
  return (
    <Card title={`Alerts · ${alerts.length}`}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ color: "var(--color-text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <th style={thStyle}>Severity</th>
            <th style={thStyle}>Alert</th>
            <th style={thStyle}>Host</th>
            <th style={thStyle}>State</th>
            <th style={thStyle}>Age</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
              <td style={tdStyle}>
                <span style={{ fontSize: "10.5px", fontWeight: 600, color: a.severity === "critical" ? "var(--color-danger)" : a.severity === "warn" ? "var(--color-warning)" : "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {a.severity}
                </span>
              </td>
              <td style={tdStyle}>
                <Link href={`/alerts/${a.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                  {a.title}
                </Link>
                <div style={{ fontSize: "10.5px", color: "var(--color-text-muted)", marginTop: "2px", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                  {a.kind}
                </div>
              </td>
              <td style={tdStyle}>
                {a.deviceId ? (
                  <Link href={`/devices/${a.deviceId}`} style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                    {a.deviceHostname ?? a.deviceId}
                  </Link>
                ) : "—"}
              </td>
              <td style={tdStyle}>
                <span style={{ padding: "1px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", background: a.state === "open" ? "var(--color-warning-soft, rgba(234, 179, 8, 0.15))" : "var(--color-background-tertiary)", color: a.state === "open" ? "var(--color-warning)" : "var(--color-text-muted)" }}>
                  {a.state}
                </span>
              </td>
              <td style={tdStyle}>{relativeLastSeen(a.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontWeight: 600,
}
const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
}
const codeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "11px",
  padding: "1px 6px",
  background: "var(--color-background-tertiary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "4px",
  color: "var(--color-text-secondary)",
}
