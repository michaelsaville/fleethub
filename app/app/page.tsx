import AppShell from "@/components/AppShell"
import StatCard from "@/components/StatCard"
import ActivityFeed, { type ActivityItem } from "@/components/ActivityFeed"

/**
 * FleetHub home dashboard. Phase 0 = mock data; the goal is to prove
 * the UI patterns work in practice (hyperlinked KPIs, activity feed,
 * dark theme, Cmd-K palette accessible from anywhere) before any real
 * data lands. Every number on this page is a link — that's the
 * UI-PATTERNS.md hard rule.
 */
const MOCK_ACTIVITY: ActivityItem[] = [
  { id: "1", ts: "14m ago", actor: "mike",   action: "patch.deploy.queued", outcome: "ok",      detail: "KB5036893 → 47 hosts (Acme)" },
  { id: "2", ts: "1h ago",  actor: "mike",   action: "script.execute",      outcome: "ok",      detail: "CleanTempFiles.ps1 on msaville-laptop" },
  { id: "3", ts: "2h ago",  actor: "system", action: "alert.opened",        outcome: "pending", detail: "Disk C: > 90% on acme-dc01" },
  { id: "4", ts: "3h ago",  actor: "mike",   action: "remote.session",      outcome: "ok",      detail: "RDP into acme-dc01 (8m)" },
  { id: "5", ts: "1d ago",  actor: "system", action: "agent.update",        outcome: "ok",      detail: "1.4.2 → 1.4.3 on 47 hosts" },
]

export default function Home() {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Fleet overview
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Phase 0 scaffold · numbers below are mock data; Phase 1 wires the real fleet.
          </p>
        </header>

        {/* KPI strip — every value hyperlinks to a filtered list */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "12px",
          }}
        >
          <StatCard label="Online devices"  value="47"  href="/devices?filter=online"        tone="ok"      hint="of 49 enrolled"     delta={{ dir: "flat", text: "vs last hr" }} />
          <StatCard label="Open alerts"     value="3"   href="/alerts?state=open"            tone="danger"  hint="1 critical"         delta={{ dir: "up", text: "+2 today" }} />
          <StatCard label="Hosts behind"    value="12"  href="/patches?compliance=behind"    tone="warn"    hint="patch coverage"     delta={{ dir: "down", text: "-3 vs Mon" }} />
          <StatCard label="Scripts queued"  value="0"   href="/scripts?state=queued"                       hint="all caught up"      delta={null} />
          <StatCard label="Clients"         value="8"   href="/clients"                                    hint="2 onboarded recently" delta={{ dir: "up", text: "+1 this week" }} />
          <StatCard label="Software updates"value="23"  href="/software?state=outdated"      tone="neutral" hint="across all clients" delta={null} />
        </section>

        {/* Below-fold split: activity feed (left) + alerts preview (right) */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
            gap: "20px",
          }}
        >
          <ActivityFeed items={MOCK_ACTIVITY} />

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
              Press <kbd style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "10px", padding: "1px 5px", background: "var(--color-background-tertiary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "3px" }}>⌘K</kbd> to try the command palette — it's the only working "feature" right now.
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
