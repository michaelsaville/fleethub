import Link from "next/link"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

const SOURCE_COLORS: Record<string, string> = {
  winget: "#3c82f6",
  choco: "#10b981",
  brew: "#f59e0b",
  custom: "#a855f7",
}

export default async function PackagesPage() {
  const packages = await prisma.fl_Package.findMany({
    where: { archivedAt: null },
    include: { versions: { orderBy: { createdAt: "desc" } } },
    orderBy: [{ tenantName: "asc" }, { name: "asc" }],
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Package catalog
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: "640px" }}>
              The deploy form picks from this catalog. Approved packages are
              available for deployment; archived ones are read-only history.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Link
              href="/packages/new"
              style={{
                fontSize: "12px",
                fontWeight: 500,
                padding: "6px 14px",
                borderRadius: "6px",
                background: "var(--color-accent)",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              + New package
            </Link>
            <Link href="/deployments" style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "6px 12px", textDecoration: "none" }}>
              Deployments →
            </Link>
          </div>
        </header>

        {packages.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--color-text-muted)", background: "var(--color-background-secondary)", border: "0.5px dashed var(--color-border-tertiary)", borderRadius: 10 }}>
            No packages yet — add Chrome / Office / 7-Zip to get started.
          </div>
        ) : (
          <div style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={th()}>Name</th>
                  <th style={th()}>Tenant</th>
                  <th style={th()}>OS</th>
                  <th style={th()}>Source</th>
                  <th style={th()}>Versions</th>
                  <th style={th()}>Reboot</th>
                  <th style={th()}>Approved</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={td()}>
                      <Link href={`/packages/${p.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                        {p.name}
                      </Link>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                        <code>{p.sourceId}</code>
                      </div>
                    </td>
                    <td style={td()}>{p.tenantName}</td>
                    <td style={td()}>{p.os}</td>
                    <td style={td()}>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: SOURCE_COLORS[p.source] ?? "var(--color-text-muted)",
                        color: "#fff",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}>
                        {p.source}
                      </span>
                    </td>
                    <td style={td()}>{p.versions.length}</td>
                    <td style={td()}>{p.rebootPolicy}</td>
                    <td style={td()}>
                      {p.isApproved ? (
                        <span style={{ color: "var(--color-success)", fontWeight: 600 }}>✓</span>
                      ) : (
                        <span style={{ color: "var(--color-warn)" }}>pending</span>
                      )}
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

function th(): React.CSSProperties {
  return { textAlign: "left", padding: "8px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "8px 10px", color: "var(--color-text-primary)", verticalAlign: "top" }
}
