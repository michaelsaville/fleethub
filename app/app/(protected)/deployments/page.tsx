import Link from "next/link"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--color-text-muted)",
  running: "var(--color-accent)",
  paused: "var(--color-warn)",
  "auto-paused": "var(--color-danger)",
  completed: "var(--color-success)",
  aborted: "var(--color-text-muted)",
}

export default async function DeploymentsPage() {
  const deployments = await prisma.fl_Deployment.findMany({
    orderBy: { createdAt: "desc" },
    include: { package: true, ring: true },
    take: 100,
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Deployments
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: "640px" }}>
              Software-deployment campaigns currently in flight + recent history.
              Click a deployment for the live monitor.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Link
              href="/deployments/new"
              style={{
                fontSize: "12px",
                fontWeight: 500,
                padding: "6px 14px",
                borderRadius: "6px",
                border: "0.5px solid var(--color-border-secondary)",
                background: "var(--color-accent)",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              + New deployment
            </Link>
            <Link
              href="/rings"
              style={linkStyle()}
            >
              Rings →
            </Link>
            <Link href="/packages" style={linkStyle()}>
              Packages →
            </Link>
          </div>
        </header>

        {deployments.length === 0 ? (
          <div
            style={{
              padding: "32px",
              textAlign: "center",
              fontSize: "13px",
              color: "var(--color-text-muted)",
              background: "var(--color-background-secondary)",
              border: "0.5px dashed var(--color-border-tertiary)",
              borderRadius: "10px",
            }}
          >
            No deployments yet. Start a new one to see the live monitor.
          </div>
        ) : (
          <div
            style={{
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
              <thead>
                <tr style={{ color: "var(--color-text-muted)", fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={th()}>Package</th>
                  <th style={th()}>Action</th>
                  <th style={th()}>Ring</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Stage</th>
                  <th style={th()}>Targets</th>
                  <th style={th()}>Started</th>
                  <th style={th()}>By</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr
                    key={d.id}
                    style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}
                  >
                    <td style={td()}>
                      <Link
                        href={`/deployments/${d.id}`}
                        style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}
                      >
                        {d.package.name}
                      </Link>
                    </td>
                    <td style={td()}>{d.action}</td>
                    <td style={td()}>{d.ring.name}</td>
                    <td style={td()}>
                      <span style={{ color: STATUS_COLORS[d.status] ?? "var(--color-text-muted)", fontWeight: 600 }}>
                        {d.status}
                      </span>
                      {d.dryRun && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-muted)" }}>· DRY-RUN</span>}
                    </td>
                    <td style={td()}>{d.currentStage ?? "—"}</td>
                    <td style={td()}>
                      <span style={{ color: "var(--color-success)" }}>{d.succeededCount}</span>
                      {" / "}
                      <span style={{ color: d.failedCount > 0 ? "var(--color-danger)" : "var(--color-text-muted)" }}>
                        {d.failedCount}
                      </span>
                      {" / "}
                      <span>{d.totalTargets}</span>
                    </td>
                    <td style={td()}>
                      {d.startedAt ? new Date(d.startedAt).toLocaleString() : "—"}
                    </td>
                    <td style={td()} title={d.requestedBy}>
                      {d.requestedBy.split("@")[0]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function linkStyle(): React.CSSProperties {
  return {
    fontSize: "12px",
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: "6px",
    border: "0.5px solid var(--color-border-tertiary)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    textDecoration: "none",
  }
}
function th(): React.CSSProperties {
  return { textAlign: "left", padding: "8px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "8px 10px", color: "var(--color-text-primary)", verticalAlign: "top" }
}
