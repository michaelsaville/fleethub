import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireSession } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { EmptyState as UiEmptyState } from "@/components/ui/EmptyState"
import { Chip } from "@/components/ui/Chip"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 2 — monitors list. Read-only in step 2;
// /monitors/new lands in step 3. ADMIN sees "+ New monitor"; TECH
// sees the list.

interface MonitorRow {
  id: string
  name: string
  tenantName: string | null
  metric: string
  predicateJson: string
  severity: string
  emitKind: string
  cooldownMin: number
  isActive: boolean
  lastEvaluatedAt: Date | null
  lastFiredAt: Date | null
  fireCount: number
  createdBy: string
}

interface Predicate {
  operator?: string
  value?: number
  osFilter?: string
  deviceTag?: string
  forMin?: number
}

export default async function MonitorsListPage() {
  const ctx = await requireSession()
  const isAdmin = ctx.role === "ADMIN"

  const monitors = await prisma.$queryRaw<MonitorRow[]>`
    SELECT id, name, "tenantName", metric, "predicateJson", severity,
           "emitKind", "cooldownMin", "isActive", "lastEvaluatedAt",
           "lastFiredAt", "fireCount", "createdBy"
    FROM fleethub.fl_monitors
    ORDER BY "isActive" DESC, name ASC
  `

  // Per-monitor recent-fire summary (last 7d).
  const since = new Date(Date.now() - 7 * 86_400_000)
  const recent = await prisma.$queryRaw<{ monitorId: string; cnt: bigint }[]>`
    SELECT "monitorId", COUNT(*) AS cnt
    FROM fleethub.fl_monitor_fires
    WHERE "firedAt" >= ${since}
    GROUP BY "monitorId"
  `
  const recentByMonitor = new Map<string, number>()
  for (const r of recent) recentByMonitor.set(r.monitorId, Number(r.cnt))

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Monitors
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: 720 }}>
              Operator-authored alert thresholds. A 1m cron evaluates
              each active monitor against rolled-up telemetry; when
              the predicate sustains for the forMin window and the
              cooldown has lapsed, an Fl_Alert fires through the same
              routing/escalation pipeline alerts from the agent use.
              Wizard + edit/disable controls land in step 3.
            </p>
          </div>
          {isAdmin && (
            <Link
              href="/monitors/new"
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
              + New monitor
            </Link>
          )}
        </header>

        {monitors.length === 0 ? (
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
                  <Th align="left">Tenant</Th>
                  <Th align="left">Threshold</Th>
                  <Th align="left">Emit</Th>
                  <Th align="right">Fires (7d)</Th>
                  <Th align="right">Last fired</Th>
                  <Th align="center">State</Th>
                </tr>
              </thead>
              <tbody>
                {monitors.map((m) => {
                  let p: Predicate = {}
                  try { p = JSON.parse(m.predicateJson) as Predicate } catch { /* shrug */ }
                  const fires7d = recentByMonitor.get(m.id) ?? 0
                  return (
                    <tr key={m.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      <Td align="left">
                        <Link href={`/monitors/${m.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 600 }}>
                          {m.name}
                        </Link>
                      </Td>
                      <Td align="left">
                        {m.tenantName ? (
                          m.tenantName
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>(all tenants)</span>
                        )}
                      </Td>
                      <Td align="left">
                        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px" }}>
                          {m.metric} {p.operator ?? "?"} {p.value ?? "?"}
                          {p.forMin ? ` · for ${p.forMin}m` : ""}
                          {p.osFilter ? ` · os=${p.osFilter}` : ""}
                        </code>
                      </Td>
                      <Td align="left">
                        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11.5px", color: "var(--color-text-secondary)" }}>
                          {m.emitKind}
                        </code>
                        <span style={{ marginLeft: 6 }}>{severityChip(m.severity)}</span>
                      </Td>
                      <Td align="right">
                        {fires7d === 0 ? (
                          <span style={{ color: "var(--color-text-muted)" }}>—</span>
                        ) : (
                          <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{fires7d}</span>
                        )}
                      </Td>
                      <Td align="right">
                        {m.lastFiredAt ? (
                          relativeAge(m.lastFiredAt)
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>—</span>
                        )}
                      </Td>
                      <Td align="center">{stateChip(m.isActive)}</Td>
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

function severityChip(severity: string): React.ReactNode {
  const tone = severity === "critical" ? "bad" : severity === "warn" ? "warn" : "neutral"
  return <Chip tone={tone}>{severity}</Chip>
}
function stateChip(isActive: boolean): React.ReactNode {
  if (!isActive) return <Chip tone="neutral">disabled</Chip>
  return <Chip tone="ok">active</Chip>
}

function relativeAge(d: Date): string {
  const ms = Date.now() - d.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
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
          ? <>No monitors yet. Click <strong>+ New monitor</strong> to bind a telemetry threshold to an alert.</>
          : <>No monitors yet. An admin can add one via the wizard.</>
      }
    />
  )
}
