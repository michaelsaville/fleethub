import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { requireSession } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { Card, CardHeader } from "@/components/ui/Card"
import { Chip } from "@/components/ui/Chip"
import { EmptyState } from "@/components/ui/EmptyState"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 2 — monitor detail. Surfaces the
// predicate, last evaluation / fire bookkeeping, and the most
// recent 50 fires (with linked Fl_Alert per fire when present).
// Edit / enable / disable controls land with the wizard in step 3.

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
  createdAt: Date
  updatedAt: Date
}

interface Predicate {
  operator?: string
  value?: number
  osFilter?: string
  deviceTag?: string
  forMin?: number
}

interface FireRow {
  id: string
  deviceId: string
  alertId: string | null
  observedValue: number | null
  firedAt: Date
}

export default async function MonitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSession()
  const { id } = await params

  const rows = await prisma.$queryRaw<MonitorRow[]>`
    SELECT id, name, "tenantName", metric, "predicateJson", severity,
           "emitKind", "cooldownMin", "isActive", "lastEvaluatedAt",
           "lastFiredAt", "fireCount", "createdBy", "createdAt", "updatedAt"
    FROM fleethub.fl_monitors
    WHERE id = ${id}
    LIMIT 1
  `
  const m = rows[0]
  if (!m) notFound()

  let p: Predicate = {}
  try { p = JSON.parse(m.predicateJson) as Predicate } catch { /* shrug */ }

  const fires = await prisma.$queryRaw<FireRow[]>`
    SELECT id, "deviceId", "alertId", "observedValue", "firedAt"
    FROM fleethub.fl_monitor_fires
    WHERE "monitorId" = ${id}
    ORDER BY "firedAt" DESC
    LIMIT 50
  `

  // Resolve device hostnames in one go so the fires table can show
  // hostname instead of cuid. Deduping the lookup makes the page
  // cheap even when the monitor fires on many devices.
  const deviceIds = Array.from(new Set(fires.map((f) => f.deviceId)))
  const devices = deviceIds.length > 0
    ? await prisma.fl_Device.findMany({
        where: { id: { in: deviceIds } },
        select: { id: true, hostname: true, clientName: true },
      })
    : []
  const deviceById = new Map(devices.map((d) => [d.id, d]))

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            <Link href="/monitors" style={{ color: "inherit", textDecoration: "none" }}>← Monitors</Link>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              {m.name}
            </h1>
            {m.isActive
              ? <Chip tone="ok">active</Chip>
              : <Chip tone="neutral">disabled</Chip>}
            {m.severity === "critical"
              ? <Chip tone="bad">{m.severity}</Chip>
              : m.severity === "warn"
                ? <Chip tone="warn">{m.severity}</Chip>
                : <Chip tone="neutral">{m.severity}</Chip>}
          </div>
        </header>

        <Card>
          <CardHeader title="Configuration" />
          <dl style={kvGridStyle}>
            <KV label="Tenant" value={m.tenantName ?? <span style={mutedSpan}>(all tenants)</span>} />
            <KV label="Metric" value={<code style={codeStyle}>{m.metric}</code>} />
            <KV
              label="Threshold"
              value={
                <code style={codeStyle}>
                  {p.operator ?? "?"} {p.value ?? "?"}
                  {p.forMin ? ` · for ${p.forMin}m` : " · for 15m"}
                </code>
              }
            />
            <KV label="OS filter" value={p.osFilter ?? <span style={mutedSpan}>any</span>} />
            <KV label="Emit kind" value={<code style={codeStyle}>{m.emitKind}</code>} />
            <KV label="Cooldown" value={`${m.cooldownMin}m per (device, monitor)`} />
            <KV label="Created by" value={m.createdBy} />
            <KV
              label="Created"
              value={m.createdAt.toLocaleString()}
            />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Status" />
          <dl style={kvGridStyle}>
            <KV
              label="Last evaluated"
              value={m.lastEvaluatedAt
                ? `${relativeAge(m.lastEvaluatedAt)} (${m.lastEvaluatedAt.toLocaleString()})`
                : <span style={mutedSpan}>never — has the cron been wired up?</span>}
            />
            <KV
              label="Last fired"
              value={m.lastFiredAt
                ? `${relativeAge(m.lastFiredAt)} (${m.lastFiredAt.toLocaleString()})`
                : <span style={mutedSpan}>never</span>}
            />
            <KV label="Total fires" value={String(m.fireCount)} />
          </dl>
        </Card>

        <Card>
          <CardHeader title={`Recent fires${fires.length > 0 ? ` · ${fires.length}` : ""}`} />
          {fires.length === 0 ? (
            <EmptyState
              body="No fires yet. The cron evaluator hasn't matched any device against this monitor's threshold."
            />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: "12.5px" }}>
                <thead>
                  <tr style={{ background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))" }}>
                    <Th align="left">When</Th>
                    <Th align="left">Device</Th>
                    <Th align="left">Client</Th>
                    <Th align="right">Observed</Th>
                    <Th align="left">Alert</Th>
                  </tr>
                </thead>
                <tbody>
                  {fires.map((f) => {
                    const dev = deviceById.get(f.deviceId)
                    return (
                      <tr key={f.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                        <Td align="left">{f.firedAt.toLocaleString()}</Td>
                        <Td align="left">
                          {dev ? (
                            <Link href={`/devices/${dev.id}`} style={{ color: "var(--color-accent, #F97316)", textDecoration: "none" }}>
                              {dev.hostname}
                            </Link>
                          ) : (
                            <span style={mutedSpan}>{f.deviceId}</span>
                          )}
                        </Td>
                        <Td align="left">{dev?.clientName ?? <span style={mutedSpan}>—</span>}</Td>
                        <Td align="right">
                          {f.observedValue == null
                            ? <span style={mutedSpan}>—</span>
                            : <code style={codeStyle}>{f.observedValue.toFixed(2)}</code>}
                        </Td>
                        <Td align="left">
                          {f.alertId ? (
                            <Link href={`/alerts/${f.alertId}`} style={{ color: "var(--color-accent, #F97316)", textDecoration: "none" }}>
                              view alert →
                            </Link>
                          ) : (
                            <span style={mutedSpan}>(writeAlert failed)</span>
                          )}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}

const kvGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  rowGap: 6,
  columnGap: 16,
  margin: 0,
  fontSize: "13px",
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: "var(--color-text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, alignSelf: "center" }}>
        {label}
      </dt>
      <dd style={{ margin: 0, color: "var(--color-text-primary)" }}>{value}</dd>
    </>
  )
}

const codeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "12px",
}
const mutedSpan: React.CSSProperties = {
  color: "var(--color-text-muted)",
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
