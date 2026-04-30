import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import ActivityFeed from "@/components/ActivityFeed"
import SeedBanner from "@/components/SeedBanner"
import { getAlert, getAlertActivity } from "@/lib/alerts"
import { getSessionContext } from "@/lib/authz"
import { relativeLastSeen } from "@/lib/devices-time"
import { ackAlert, resolveAlert } from "../actions"

export const dynamic = "force-dynamic"

export default async function AlertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const alert = await getAlert(id)
  if (!alert) notFound()

  const ctx = await getSessionContext()
  const isAdmin = ctx?.role === "ADMIN"
  const activity = await getAlertActivity(id)

  const sevColor =
    alert.severity === "critical" ? "var(--color-danger)" :
    alert.severity === "warn"     ? "var(--color-warning)" :
                                     "var(--color-text-muted)"

  const stateBadge = {
    open:     { bg: "var(--color-warning-soft, rgba(234, 179, 8, 0.15))", fg: "var(--color-warning)", label: "OPEN" },
    ack:      { bg: "var(--color-background-tertiary)",                   fg: "var(--color-text-secondary)", label: "ACKNOWLEDGED" },
    resolved: { bg: "var(--color-success-soft, rgba(34, 197, 94, 0.15))", fg: "var(--color-success)", label: "RESOLVED" },
  }[alert.state]

  return (
    <AppShell openAlertsCount={alert.state === "open" ? 1 : 0}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "920px" }}>
        <Breadcrumb alertTitle={alert.title} />

        <header style={{ display: "flex", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
          <span
            aria-label={alert.severity}
            style={{
              marginTop: "8px",
              width: "10px",
              height: "10px",
              borderRadius: "999px",
              background: sevColor,
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
              {alert.title}
            </h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "6px", alignItems: "center" }}>
              <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px", color: "var(--color-text-muted)" }}>
                {alert.kind}
              </code>
              <span style={{ fontSize: "11px", color: sevColor, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {alert.severity}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 8px",
                  borderRadius: "999px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: stateBadge.bg,
                  color: stateBadge.fg,
                }}
              >
                {stateBadge.label}
              </span>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                fired {relativeLastSeen(alert.createdAt)}
              </span>
            </div>
          </div>
        </header>

        {alert.isMock && <SeedBanner kind="device" />}

        <ActionRow alert={alert} isAdmin={isAdmin} />

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <Card title="Detail">
              {alert.detail ? (
                <p style={{ fontSize: "13px", color: "var(--color-text-primary)", lineHeight: 1.55, margin: 0 }}>
                  {alert.detail}
                </p>
              ) : (
                <Empty>No additional detail recorded.</Empty>
              )}
            </Card>
            <ActivityFeed items={activity} title="Audit trail" />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <Card title="Context">
              <KVGrid pairs={[
                ["Host",      alert.deviceId
                                ? <Link href={`/devices/${alert.deviceId}`} style={hostLinkStyle}>{alert.deviceHostname ?? alert.deviceId}</Link>
                                : "—"],
                ["Client",    alert.clientName
                                ? <Link href={`/devices?client=${encodeURIComponent(alert.clientName)}`} style={{ color: "var(--color-text-primary)", textDecoration: "none" }}>{alert.clientName}</Link>
                                : "—"],
                ["Severity",  alert.severity],
                ["State",     alert.state],
                ["Fired",     alert.createdAt.toLocaleString()],
                ["Acked by",  alert.ackedBy ?? "—"],
                ["Acked at",  alert.ackedAt ? alert.ackedAt.toLocaleString() : "—"],
                ["Resolved",  alert.resolvedAt ? alert.resolvedAt.toLocaleString() : "—"],
                ["Alert ID",  <code key="id" style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px" }}>{alert.id}</code>],
              ]} />
            </Card>
          </div>
        </section>
      </div>
    </AppShell>
  )
}

function Breadcrumb({ alertTitle }: { alertTitle: string }) {
  return (
    <nav style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>
      <Link href="/alerts" style={{ color: "var(--color-text-secondary)", textDecoration: "none" }}>
        Alerts
      </Link>
      <span style={{ margin: "0 6px" }}>›</span>
      <span style={{ color: "var(--color-text-primary)" }}>{truncate(alertTitle, 80)}</span>
    </nav>
  )
}

function ActionRow({
  alert,
  isAdmin,
}: {
  alert: { id: string; state: "open" | "ack" | "resolved"; isMock: boolean }
  isAdmin: boolean
}) {
  const canMutate = isAdmin && !alert.isMock
  const reason = !isAdmin
    ? "ADMIN role required"
    : alert.isMock
    ? "Seed alert — real ack/resolve ships with the agent"
    : ""

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
      <form action={ackAlert}>
        <input type="hidden" name="id" value={alert.id} />
        <button
          type="submit"
          disabled={!canMutate || alert.state !== "open"}
          title={alert.state !== "open" ? `Already ${alert.state}` : reason || undefined}
          style={buttonStyle(canMutate && alert.state === "open")}
        >
          Acknowledge
        </button>
      </form>
      <form action={resolveAlert}>
        <input type="hidden" name="id" value={alert.id} />
        <button
          type="submit"
          disabled={!canMutate || alert.state === "resolved"}
          title={alert.state === "resolved" ? "Already resolved" : reason || undefined}
          style={buttonStyle(canMutate && alert.state !== "resolved")}
        >
          Resolve
        </button>
      </form>
      <span style={{ flex: 1 }} />
      {!canMutate && reason && (
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)", alignSelf: "center" }}>
          {reason}
        </span>
      )}
    </div>
  )
}

function buttonStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 500,
    borderRadius: "6px",
    border: active ? "0.5px solid var(--color-accent)" : "0.5px solid var(--color-border-tertiary)",
    background: active ? "var(--color-accent)" : "transparent",
    color: active ? "white" : "var(--color-text-muted)",
    cursor: active ? "pointer" : "not-allowed",
  }
}

const hostLinkStyle: React.CSSProperties = {
  color: "var(--color-text-primary)",
  textDecoration: "none",
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "11.5px",
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

function KVGrid({ pairs }: { pairs: Array<[string, React.ReactNode]> }) {
  return (
    <dl
      style={{
        margin: 0,
        display: "grid",
        gridTemplateColumns: "minmax(80px, 32%) 1fr",
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

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)", lineHeight: 1.55 }}>{children}</div>
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}
