import Link from "next/link"
import AppShell from "@/components/AppShell"
import SeedBanner from "@/components/SeedBanner"
import { listClients } from "@/lib/clients"
import { mockMode } from "@/lib/devices"
import { relativeLastSeen } from "@/lib/devices-time"
import type { ClientRow } from "@/lib/clients"

export const dynamic = "force-dynamic"

export default async function ClientsPage() {
  const [clients, isMock] = await Promise.all([listClients(), mockMode()])

  const totals = {
    clients: clients.length,
    devices: clients.reduce((n, c) => n + c.deviceCount, 0),
    online: clients.reduce((n, c) => n + c.onlineCount, 0),
    open: clients.reduce((n, c) => n + c.openAlerts, 0),
    critical: clients.reduce((n, c) => n + c.criticalAlerts, 0),
  }

  return (
    <AppShell openAlertsCount={totals.open}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Clients
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Fleet rollup per managed client. Each card links into a
            client-scoped view of devices, alerts, and activity.
            Asset documentation lives in DocHub.
          </p>
        </header>

        {isMock && <SeedBanner kind="fleet" />}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "8px",
          }}
        >
          <SummaryCard label="Clients"        value={totals.clients}  hint="active fleets" />
          <SummaryCard label="Devices"        value={totals.devices}  hint={`${totals.online} online`} />
          <SummaryCard label="Open alerts"    value={totals.open}     hint={totals.critical > 0 ? `${totals.critical} critical` : "all monitored"} tone={totals.open > 0 ? "warn" : "ok"} />
        </section>

        {clients.length === 0 ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "10px",
              color: "var(--color-text-muted)",
              fontSize: "13px",
            }}
          >
            No clients yet. Once an agent enrolls (see{" "}
            <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "12px" }}>
              docs/AGENT-PROTOCOL.md
            </code>
            ) the client will appear here.
          </div>
        ) : (
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "12px",
            }}
          >
            {clients.map((c) => <ClientCard key={c.name} client={c} />)}
          </section>
        )}
      </div>
    </AppShell>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string
  value: number
  hint: string
  tone?: "neutral" | "ok" | "warn"
}) {
  const valueColor = tone === "warn" ? "var(--color-warning)" : tone === "ok" ? "var(--color-success)" : "var(--color-text-primary)"
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
      }}
    >
      <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 600, color: valueColor, marginTop: "4px", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "4px" }}>
        {hint}
      </div>
    </div>
  )
}

function ClientCard({ client }: { client: ClientRow }) {
  const onlinePct = client.deviceCount > 0
    ? Math.round((client.onlineCount / client.deviceCount) * 100)
    : 0
  const onlineTone = onlinePct === 100 ? "var(--color-success)" : onlinePct >= 80 ? "var(--color-warning)" : "var(--color-danger)"
  const hasAlerts = client.openAlerts > 0
  const isCritical = client.criticalAlerts > 0
  return (
    <Link
      href={`/clients/${encodeURIComponent(client.name)}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "14px",
        background: "var(--color-background-secondary)",
        border: isCritical ? "0.5px solid var(--color-danger)" : "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {client.name}
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "2px" }}>
            {client.deviceCount} device{client.deviceCount === 1 ? "" : "s"}
            {client.newestActivity && ` · last seen ${relativeLastSeen(client.newestActivity)}`}
          </div>
        </div>
        {hasAlerts && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "999px",
              fontSize: "10px",
              fontWeight: 600,
              background: isCritical
                ? "var(--color-danger-soft, rgba(239, 68, 68, 0.15))"
                : "var(--color-warning-soft, rgba(234, 179, 8, 0.15))",
              color: isCritical ? "var(--color-danger)" : "var(--color-warning)",
            }}
          >
            {client.openAlerts} alert{client.openAlerts === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
          <span>Online</span>
          <span style={{ color: onlineTone, fontWeight: 600 }}>
            {client.onlineCount}/{client.deviceCount} · {onlinePct}%
          </span>
        </div>
        <div style={{ height: "4px", background: "var(--color-background-tertiary)", borderRadius: "999px", overflow: "hidden" }}>
          <div style={{ width: `${onlinePct}%`, height: "100%", background: onlineTone }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", fontSize: "11px" }}>
        <Stat label="Hosts behind patch" value={client.hostsBehindPatch} tone={client.hostsBehindPatch > 0 ? "warn" : "ok"} />
        <Stat label="Oldest hardware" value={client.oldestPurchase ? client.oldestPurchase.slice(0, 7) : "—"} tone="neutral" />
      </div>
    </Link>
  )
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: "ok" | "warn" | "neutral" }) {
  const color = tone === "warn" ? "var(--color-warning)" : tone === "ok" ? "var(--color-success)" : "var(--color-text-primary)"
  return (
    <div>
      <div style={{ fontSize: "10px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: "13px", fontWeight: 600, color, marginTop: "2px" }}>
        {value}
      </div>
    </div>
  )
}
