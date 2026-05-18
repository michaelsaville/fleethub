import Link from "next/link"
import AppShell from "@/components/AppShell"
import { Card } from "@/components/ui/Card"
import { EmptyState } from "@/components/ui/EmptyState"
import { Button } from "@/components/ui/Button"
import { prisma } from "@/lib/prisma"
import { countGroupTargets } from "@/lib/targeting"

export const dynamic = "force-dynamic"

// Phase 9 WS-C §5.1 — list Fl_DeviceGroup rows + member count.
// The schema landed in Phase 3 with zero UI; this is the first
// operator surface. Wires as a targeter for deployments/monitors
// in WS-A 3.4 + WS-A 3.2.

export default async function GroupsPage() {
  const groups = await prisma.fl_DeviceGroup.findMany({
    orderBy: [{ tenantName: "asc" }, { name: "asc" }],
  })

  // Resolve member counts in parallel — cheap query per group.
  const counts = await Promise.all(groups.map((g) => countGroupTargets(g.id)))

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4, letterSpacing: "-0.01em" }}>
              Device groups
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0, maxWidth: 640 }}>
              Reusable target sets for deployments, monitors, and scripts.
              Pinned (static) device list and/or RQL fragment (re-evaluated at use time).
            </p>
          </div>
          <Link href="/groups/new"><Button variant="primary">+ New group</Button></Link>
        </header>

        {groups.length === 0 ? (
          <EmptyState
            body="No device groups yet."
            action={<Link href="/groups/new"><Button variant="primary">+ New group</Button></Link>}
          />
        ) : (
          <Card padding={0} style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={th()}>Name</th>
                  <th style={th()}>Tenant</th>
                  <th style={th()}>Members</th>
                  <th style={th()}>RQL</th>
                  <th style={th()}>Created</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={g.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={td()}>
                      <Link href={`/groups/${g.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                        {g.name}
                      </Link>
                    </td>
                    <td style={td()}>{g.tenantName}</td>
                    <td style={td()}>{counts[i]}</td>
                    <td style={td()}>
                      {g.rql ? <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>{g.rql}</code> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                    </td>
                    <td style={td()}>{g.createdAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </AppShell>
  )
}

function th(): React.CSSProperties {
  return { textAlign: "left", padding: "8px 12px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "8px 12px", color: "var(--color-text-primary)", verticalAlign: "top" }
}
