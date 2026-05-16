import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireSession } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { EmptyState as UiEmptyState } from "@/components/ui/EmptyState"
import { Chip } from "@/components/ui/Chip"

export const dynamic = "force-dynamic"

// Phase 7 Workstream B step 2 — runbook list. Read-only in step 2;
// the new-runbook wizard lands in step 3. ADMIN sees "+ New
// runbook"; TECH sees the list but no editor.

interface MatchPredicate {
  severity?: string[] | string
  kindLike?: string
}

export default async function RunbooksListPage() {
  const ctx = await requireSession()
  const isAdmin = ctx.role === "ADMIN"

  const runbooks = await prisma.fl_Runbook.findMany({
    orderBy: [{ isTripped: "desc" }, { isActive: "desc" }, { name: "asc" }],
    include: {
      script: { select: { name: true, shell: true } },
      _count: { select: { fires: true } },
    },
  })

  // Last-7d activity summary per runbook — cheap groupBy.
  const since = new Date(Date.now() - 7 * 86_400_000)
  const recent = await prisma.fl_RunbookFire.groupBy({
    by: ["runbookId", "state"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  })
  const recentByRunbook = new Map<string, Record<string, number>>()
  for (const r of recent) {
    const m = recentByRunbook.get(r.runbookId) ?? {}
    m[r.state] = r._count._all
    recentByRunbook.set(r.runbookId, m)
  }

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Runbooks
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: 720 }}>
              Auto-remediation: when an alert matches a runbook&rsquo;s
              criteria, the signed script runs on the affected device
              after a grace window. Cooldown per (kind, device)
              prevents fire-storms. Edit / disable / untrip controls
              land with the wizard in step 3.
            </p>
          </div>
          {isAdmin && (
            <Link
              href="/runbooks/new"
              style={{
                flexShrink: 0,
                padding: "8px 14px",
                background: "var(--color-accent, #F97316)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 600,
                borderRadius: "8px",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              + New runbook
            </Link>
          )}
        </header>

        {runbooks.length === 0 ? (
          <EmptyState isAdmin={isAdmin} />
        ) : (
          <div style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "10px",
            overflowX: "auto",
          }}>
            <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: "12.5px" }}>
              <thead>
                <tr style={{ background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))" }}>
                  <Th align="left">Name</Th>
                  <Th align="left">Match</Th>
                  <Th align="left">Script</Th>
                  <Th align="right">Grace</Th>
                  <Th align="right">Cooldown</Th>
                  <Th align="right">Fires (7d)</Th>
                  <Th align="center">State</Th>
                </tr>
              </thead>
              <tbody>
                {runbooks.map((r) => {
                  let m: MatchPredicate = {}
                  try { m = JSON.parse(r.matchJson) as MatchPredicate } catch { /* shrug */ }
                  const recentMap = recentByRunbook.get(r.id) ?? {}
                  const fired = (recentMap["running"] ?? 0) + sum(recentMap, ["succeeded"])
                  const skipped = sum(recentMap, ["skipped-cooldown", "skipped-cleared", "skipped-tripped"])
                  const failed = recentMap["failed"] ?? 0
                  return (
                    <tr key={r.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      <Td align="left">
                        <Link href={`/runbooks/${r.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 600 }}>
                          {r.name}
                        </Link>
                      </Td>
                      <Td align="left">{describeMatch(m)}</Td>
                      <Td align="left">
                        <Link href={`/scripts/${r.scriptId}`} style={{ color: "var(--color-accent, #F97316)", textDecoration: "none" }}>
                          {r.script.name}
                        </Link>
                        <span style={{ color: "var(--color-text-muted)", marginLeft: 6, fontSize: 11 }}>
                          {r.script.shell}
                        </span>
                      </Td>
                      <Td align="right">{r.graceMin}m</Td>
                      <Td align="right">{r.cooldownMin}m</Td>
                      <Td align="right">
                        {fired === 0 && skipped === 0 && failed === 0 ? (
                          <span style={{ color: "var(--color-text-muted)" }}>—</span>
                        ) : (
                          <span>
                            <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{fired}</span>
                            {failed > 0 && <span style={{ color: "var(--color-danger, #b91c1c)", marginLeft: 4 }}>·{failed} failed</span>}
                            {skipped > 0 && <span style={{ color: "var(--color-text-muted)", marginLeft: 4 }}>·{skipped} skipped</span>}
                          </span>
                        )}
                      </Td>
                      <Td align="center">{stateChip(r.isActive, r.isTripped)}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function describeMatch(m: MatchPredicate): React.ReactNode {
  const parts: string[] = []
  if (m.severity) {
    const sev = Array.isArray(m.severity) ? m.severity : [m.severity]
    parts.push(`severity: ${sev.join(", ")}`)
  }
  if (m.kindLike) parts.push(`kind: ${m.kindLike}`)
  if (parts.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>any</span>
  return (
    <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
      {parts.join(" · ")}
    </code>
  )
}

function stateChip(isActive: boolean, isTripped: boolean): React.ReactNode {
  if (isTripped) return <Chip tone="bad">tripped</Chip>
  if (!isActive) return <Chip tone="neutral">disabled</Chip>
  return <Chip tone="ok">active</Chip>
}

function sum(map: Record<string, number>, keys: string[]): number {
  let total = 0
  for (const k of keys) total += map[k] ?? 0
  return total
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return (
    <th style={{ padding: "8px 12px", textAlign: align, fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
      {children}
    </th>
  )
}
function Td({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return <td style={{ padding: "10px 12px", textAlign: align, whiteSpace: "nowrap" }}>{children}</td>
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <UiEmptyState
      body={
        isAdmin
          ? <>No runbooks yet. Click <strong>+ New runbook</strong> to bind an alert pattern to a signed script.</>
          : <>No runbooks yet. An admin can add one via the wizard.</>
      }
    />
  )
}
