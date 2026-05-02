import Link from "next/link"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import { parseStages } from "@/lib/rings"
import RingSeedButton from "./RingSeedButton"

export const dynamic = "force-dynamic"

export default async function RingsPage() {
  const rings = await prisma.fl_DeployRing.findMany({
    where: { archivedAt: null },
    orderBy: [{ tenantName: "asc" }, { name: "asc" }],
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4 }}>
              Update rings
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0, maxWidth: 640 }}>
              Reusable rollout shapes (canary → wave → full) with auto-promote rules and abort thresholds.
              The deploy form picks one per deployment; per-tenant default applies when absent.
            </p>
          </div>
          <RingSeedButton />
        </header>

        {rings.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", fontSize: 13, color: "var(--color-text-muted)", background: "var(--color-background-secondary)", border: "0.5px dashed var(--color-border-tertiary)", borderRadius: 10 }}>
            No rings yet. Use “Seed default rings” to create the standard 4-stage + healthcare-conservative rings.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rings.map((r) => {
              const stages = parseStages(r.stagesJson)
              return (
                <section key={r.id} style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div>
                      <strong style={{ fontSize: 14 }}>{r.name}</strong>
                      {r.isDefault && <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 4, background: "var(--color-accent)", color: "#fff", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>default</span>}
                      <span style={{ marginLeft: 8, color: "var(--color-text-muted)", fontSize: 12 }}>tenant: {r.tenantName}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                      {stages.length} stage{stages.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        <th style={th()}>Stage</th>
                        <th style={th()}>Selector</th>
                        <th style={th()}>Abort if &gt;</th>
                        <th style={th()}>Auto-promote</th>
                        <th style={th()}>Approval</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stages.map((s) => (
                        <tr key={s.name} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                          <td style={td()}><strong>{s.name}</strong></td>
                          <td style={td()}>
                            {s.selector.kind === "pinned" && `pinned (${s.selector.deviceIds.length} hosts)`}
                            {s.selector.kind === "filter" && <code>{s.selector.rql}</code>}
                            {s.selector.kind === "percentile" && `${s.selector.percent}%`}
                            {s.selector.kind === "remaining" && "remaining"}
                          </td>
                          <td style={td()}>{(s.abortFailureRate * 100).toFixed(0)}%</td>
                          <td style={td()}>
                            {s.autoPromoteAfterSec === 0
                              ? "manual"
                              : s.autoPromoteAfterSec >= 3600
                                ? `${(s.autoPromoteAfterSec / 3600).toFixed(0)}h`
                                : `${(s.autoPromoteAfterSec / 60).toFixed(0)}m`}
                          </td>
                          <td style={td()}>{s.requiresApproval ? "🔒 required" : "auto"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )
            })}
          </div>
        )}
        <p style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          Editing rings beyond the seed action is a Phase 3 step 6 follow-up — for now use the seed to bootstrap, then deploy with the defaults.
        </p>
      </div>
    </AppShell>
  )
}

function th(): React.CSSProperties {
  return { textAlign: "left", padding: "6px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "6px 10px", color: "var(--color-text-primary)", verticalAlign: "top" }
}
