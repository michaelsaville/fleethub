import AppShell from "@/components/AppShell"
import StatCard from "@/components/StatCard"
import ActivityFeed from "@/components/ActivityFeed"
import { getDashboardStats, getRecentActivity } from "@/lib/dashboard"

export const dynamic = "force-dynamic"

/**
 * FleetHub home dashboard. Every value below comes from a live DB
 * query — even when the answer is 0, the wiring is real. Per
 * UI-PATTERNS.md, every number on this page is a hyperlink.
 */
export default async function Home() {
  const [stats, activity] = await Promise.all([
    getDashboardStats(),
    getRecentActivity(8),
  ])

  const onlineHint =
    stats.totalDevices === 0
      ? "no devices enrolled yet"
      : `of ${stats.totalDevices} enrolled`
  const alertsHint =
    stats.criticalAlerts > 0
      ? `${stats.criticalAlerts} critical`
      : stats.openAlerts === 0
      ? "all clear"
      : "none critical"
  const onlineTone = stats.totalDevices === 0
    ? "neutral"
    : stats.onlineDevices === stats.totalDevices
    ? "ok"
    : "warn"
  const alertsTone =
    stats.criticalAlerts > 0 ? "danger" : stats.openAlerts > 0 ? "warn" : "ok"

  return (
    <AppShell openAlertsCount={stats.openAlerts}>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Fleet overview
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Phase 0 — live counts; the fleet itself populates once the agent ships.
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "12px",
          }}
        >
          <StatCard
            label="Online devices"
            value={stats.onlineDevices}
            href="/devices?filter=online"
            tone={onlineTone}
            hint={onlineHint}
          />
          <StatCard
            label="Open alerts"
            value={stats.openAlerts}
            href="/alerts?state=open"
            tone={alertsTone}
            hint={alertsHint}
          />
          <StatCard
            label="Hosts behind"
            value={stats.hostsBehindPatch}
            href="/patches?compliance=behind"
            tone="neutral"
            hint="patch coverage · Phase 4"
          />
          <StatCard
            label="Scripts queued"
            value={stats.scriptsQueued}
            href="/scripts?state=queued"
            tone="neutral"
            hint={stats.scriptsQueued === 0 ? "all caught up" : "in flight"}
          />
          <StatCard
            label="Clients"
            value={stats.clientsWithDevices}
            href="/clients"
            tone="neutral"
            hint={stats.clientsWithDevices === 0 ? "none with devices yet" : "with active devices"}
          />
          <StatCard
            label="Software updates"
            value={stats.softwareUpdatesPending}
            href="/software?state=outdated"
            tone="neutral"
            hint="Phase 3"
          />
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
            gap: "20px",
          }}
        >
          <ActivityFeed items={activity} />

          <div
            style={{
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "10px",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                marginBottom: "10px",
              }}
            >
              Build status
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "12px", lineHeight: 1.7 }}>
              <li>✅ Phase 0 scaffold — sidebar, Cmd-K, dashboard</li>
              <li>⏳ Phase 1 — fleet inventory (waits on agent)</li>
              <li>⏳ Phase 2 — script orchestration</li>
              <li>⏳ Phase 3 — software deployment</li>
              <li>⏳ Phase 4 — patch management (the chunky one)</li>
              <li>⏳ Phase 5 — perf + compliance reports</li>
            </ul>
            <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--color-text-muted)" }}>
              Press <kbd style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "10px", padding: "1px 5px", background: "var(--color-background-tertiary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "3px" }}>⌘K</kbd> to open the command palette.
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
