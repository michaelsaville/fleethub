import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { requireSession } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { relativeLastSeen } from "@/lib/devices-time"

export const dynamic = "force-dynamic"

interface MatchPredicate {
  severity?: string[] | string
  kindLike?: string
}

export default async function RunbookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSession()
  const { id } = await params

  const runbook = await prisma.fl_Runbook.findUnique({
    where: { id },
    include: {
      script: { select: { id: true, name: true, shell: true, dryRunCapable: true } },
    },
  })
  if (!runbook) notFound()

  const [fires, devices] = await Promise.all([
    prisma.fl_RunbookFire.findMany({
      where: { runbookId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        alertId: true,
        deviceId: true,
        alertKind: true,
        scheduledAt: true,
        state: true,
        realScriptRunId: true,
        failureReason: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    prisma.fl_Device.findMany({
      where: {
        id: {
          in: await prisma.fl_RunbookFire.findMany({
            where: { runbookId: id },
            distinct: ["deviceId"],
            select: { deviceId: true },
          }).then((rows) => rows.map((r) => r.deviceId)),
        },
      },
      select: { id: true, hostname: true, clientName: true },
    }),
  ])
  const deviceById = new Map(devices.map((d) => [d.id, d]))

  let match: MatchPredicate = {}
  try { match = JSON.parse(runbook.matchJson) as MatchPredicate } catch { /* shrug */ }

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              {runbook.name}
            </h1>
            {stateChip(runbook.isActive, runbook.isTripped)}
          </div>
          {runbook.description && (
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: "4px 0 0" }}>
              {runbook.description}
            </p>
          )}
        </header>

        {runbook.isTripped && (
          <div style={{
            padding: "10px 12px",
            background: "var(--color-danger-soft, rgba(239, 68, 68, 0.1))",
            border: "0.5px solid var(--color-danger, #b91c1c)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--color-danger, #b91c1c)",
          }}>
            <strong>Runbook tripped.</strong> {runbook.trippedReason ?? "Circuit breaker engaged."}{" "}
            {runbook.trippedAt && <span style={{ color: "var(--color-text-muted)" }}>· {relativeLastSeen(runbook.trippedAt)}</span>}
            <br />
            <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
              Untrip lands with step 4 (circuit breaker) + step 6 (Cmd-K). Until then, clear via Prisma: <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>UPDATE fl_runbooks SET is_tripped=false WHERE id=&apos;{runbook.id}&apos;</code>
            </span>
          </div>
        )}

        <ConfigSection runbook={runbook} match={match} />

        <h2 style={{ fontSize: 14, fontWeight: 600, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Fire history ({fires.length}{fires.length === 100 ? "+" : ""})
        </h2>
        {fires.length === 0 ? (
          <div style={{
            padding: "30px",
            textAlign: "center",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "10px",
            color: "var(--color-text-muted)",
            fontSize: "13px",
          }}>
            This runbook hasn&rsquo;t fired yet. Once a matching alert lands and the grace window elapses, fires show up here.
          </div>
        ) : (
          <div style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "10px",
            overflowX: "auto",
          }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", fontSize: "12.5px" }}>
              <thead>
                <tr style={{ background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))" }}>
                  <Th align="left">When</Th>
                  <Th align="left">Device</Th>
                  <Th align="left">Alert kind</Th>
                  <Th align="center">State</Th>
                  <Th align="left">Script run</Th>
                  <Th align="left">Detail</Th>
                </tr>
              </thead>
              <tbody>
                {fires.map((f) => {
                  const dev = deviceById.get(f.deviceId)
                  return (
                    <tr key={f.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                      <Td align="left">
                        <span style={{ color: "var(--color-text-primary)" }}>{relativeLastSeen(f.createdAt)}</span>
                        <br />
                        <span style={{ fontSize: 10.5, color: "var(--color-text-muted)" }}>{f.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                      </Td>
                      <Td align="left">
                        {dev ? (
                          <Link href={`/devices/${dev.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none" }}>
                            {dev.hostname}
                            <span style={{ color: "var(--color-text-muted)", marginLeft: 6, fontSize: 11 }}>· {dev.clientName}</span>
                          </Link>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>(deleted device)</span>
                        )}
                      </Td>
                      <Td align="left">
                        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                          {f.alertKind ?? "—"}
                        </code>
                      </Td>
                      <Td align="center">{fireStateChip(f.state)}</Td>
                      <Td align="left">
                        {f.realScriptRunId ? (
                          <Link href={`/runs/${f.realScriptRunId}`} style={{ color: "var(--color-accent, #F97316)", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>
                            {f.realScriptRunId.slice(0, 8)}…
                          </Link>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>—</span>
                        )}
                      </Td>
                      <Td align="left">
                        <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                          {f.failureReason ?? (f.state === "pending" ? `scheduled ${relativeLastSeen(f.scheduledAt)}` : "")}
                        </span>
                      </Td>
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function ConfigSection({ runbook, match }: {
  runbook: { graceMin: number; cooldownMin: number; maxFiresPerHour: number; maxConsecutiveFailures: number; dryRunFirst: boolean; script: { id: string; name: string; shell: string; dryRunCapable: boolean } }
  match: MatchPredicate
}) {
  const matchParts: string[] = []
  if (match.severity) {
    const sev = Array.isArray(match.severity) ? match.severity : [match.severity]
    matchParts.push(`severity: ${sev.join(", ")}`)
  }
  if (match.kindLike) matchParts.push(`kind: ${match.kindLike}`)
  return (
    <section style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: "10px",
      padding: "14px 16px",
      background: "var(--color-background-secondary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: 10,
    }}>
      <ConfigCell label="Match">
        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
          {matchParts.length > 0 ? matchParts.join(" · ") : "any"}
        </code>
      </ConfigCell>
      <ConfigCell label="Script">
        <Link href={`/scripts/${runbook.script.id}`} style={{ color: "var(--color-accent, #F97316)", textDecoration: "none" }}>
          {runbook.script.name}
        </Link>
        <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 2 }}>
          {runbook.script.shell} · {runbook.script.dryRunCapable ? "dry-run capable" : "always live"}
        </div>
      </ConfigCell>
      <ConfigCell label="Grace">
        {runbook.graceMin} min
        <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 2 }}>wait before fire</div>
      </ConfigCell>
      <ConfigCell label="Cooldown">
        {runbook.cooldownMin} min
        <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 2 }}>per (kind, device)</div>
      </ConfigCell>
      <ConfigCell label="Circuit breaker">
        <span style={{ fontSize: 11.5 }}>
          ≤ {runbook.maxFiresPerHour}/hr · ≤ {runbook.maxConsecutiveFailures} fails
        </span>
        <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 2 }}>
          step 4 wires the trip
        </div>
      </ConfigCell>
      <ConfigCell label="Dry-run first">
        {runbook.dryRunFirst ? "yes" : "no"}
        <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 2 }}>
          step 5 honors this
        </div>
      </ConfigCell>
    </section>
  )
}

function ConfigCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--color-text-primary)", marginTop: 4 }}>{children}</div>
    </div>
  )
}

function stateChip(isActive: boolean, isTripped: boolean): React.ReactNode {
  if (isTripped) return chip("tripped", "var(--color-danger, #b91c1c)", "var(--color-danger-soft, rgba(239, 68, 68, 0.15))")
  if (!isActive) return chip("disabled", "var(--color-text-muted)", "var(--color-background-tertiary, rgba(148, 163, 184, 0.18))")
  return chip("active", "var(--color-success, #15803d)", "var(--color-success-soft, rgba(21, 128, 61, 0.15))")
}

function fireStateChip(state: string): React.ReactNode {
  const color =
    state === "running" || state === "succeeded" ? "var(--color-success, #15803d)" :
    state === "pending" ? "var(--color-text-secondary)" :
    state === "failed" ? "var(--color-danger, #b91c1c)" :
    "var(--color-text-muted)"
  const bg =
    state === "running" || state === "succeeded" ? "var(--color-success-soft, rgba(21, 128, 61, 0.15))" :
    state === "pending" ? "var(--color-background-tertiary, rgba(148, 163, 184, 0.18))" :
    state === "failed" ? "var(--color-danger-soft, rgba(239, 68, 68, 0.15))" :
    "var(--color-background-tertiary, rgba(148, 163, 184, 0.18))"
  return chip(state.replace(/^skipped-/, ""), color, bg)
}

function chip(label: string, color: string, bg: string): React.ReactNode {
  return (
    <span style={{ padding: "1px 8px", fontSize: "10px", fontWeight: 600, borderRadius: 999, background: bg, color, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
      {label}
    </span>
  )
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return (
    <th style={{ padding: "8px 12px", textAlign: align, fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
      {children}
    </th>
  )
}
function Td({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return <td style={{ padding: "8px 12px", textAlign: align, verticalAlign: "top" }}>{children}</td>
}
