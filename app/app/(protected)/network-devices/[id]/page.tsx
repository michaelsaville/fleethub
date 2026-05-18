import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { DataTable, TH, TD } from "@/components/ui/Table"
import { Button } from "@/components/ui/Button"
import { StatusDot } from "@/components/ui/StatusDot"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"

// Phase 12 WS-A.7 — network device detail page. 24h hourly rollup
// for trend; latest 50 probes for forensic.

export const dynamic = "force-dynamic"

export default async function NetworkDeviceDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSession()
  const { id } = await params
  const device = await prisma.fl_NetworkDevice.findUnique({ where: { id } })
  if (!device || !device.isActive) notFound()

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600_000)
  const [hours, recent] = await Promise.all([
    prisma.fl_NetworkProbeHour.findMany({
      where: {
        networkDeviceId: id,
        hour: { gte: twentyFourHoursAgo },
      },
      orderBy: { hour: "desc" },
    }),
    prisma.fl_NetworkProbe.findMany({
      where: { networkDeviceId: id },
      orderBy: { ts: "desc" },
      take: 50,
    }),
  ])
  const last = recent[0]
  const tone: "ok" | "muted" | "danger" = !last
    ? "muted"
    : last.ok
    ? "ok"
    : "danger"
  // Build a simple text sparkline of last 24 hourly p95s.
  const reversedHours = [...hours].reverse()
  const sparkChars = "▁▂▃▄▅▆▇█"
  const sparkline = (() => {
    if (reversedHours.length === 0) return ""
    const vals = reversedHours.map((h) => h.p95Ms ?? 0)
    const max = Math.max(...vals, 1)
    return vals
      .map((v) => sparkChars[Math.min(sparkChars.length - 1, Math.floor((v / max) * (sparkChars.length - 1)))])
      .join("")
  })()

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
        <div style={{ ...TYPOGRAPHY.HINT }}>
          <Link href="/network-devices" style={{ color: "var(--color-text-accent)" }}>
            ← Network devices
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusDot tone={tone} size={10} label={last?.ok ? "reachable" : "unreachable"} />
          <h1 style={TYPOGRAPHY.H1}>{device.displayName}</h1>
        </div>
        <div style={TYPOGRAPHY.HINT}>
          {device.clientName} · {device.kind} · {device.ipAddress} ·{" "}
          ICMP {device.icmpEnabled ? "✓" : "—"} · SNMP {device.snmpVersion}
        </div>

        <Card>
          <CardHeader title="24-hour p95 latency (hourly)" />
          {hours.length === 0 ? (
            <div style={{ ...TYPOGRAPHY.HINT }}>
              No rollup data yet. Hourly rollup runs at the top of every hour.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 28, letterSpacing: "0.05em" }}>
                {sparkline}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, fontSize: 11.5 }}>
                {reversedHours.slice(-12).map((h) => (
                  <div
                    key={h.hour.toISOString()}
                    style={{
                      padding: "4px 6px",
                      background: "var(--color-background-tertiary)",
                      borderRadius: 4,
                    }}
                  >
                    <div style={{ color: "var(--color-text-muted)", fontSize: 10.5 }}>
                      {new Date(h.hour).toLocaleString(undefined, { hour: "numeric" })}
                    </div>
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                      p95 {h.p95Ms?.toFixed(0) ?? "—"} ms · loss {h.lossPct.toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={`Recent probes (${recent.length})`} />
          {recent.length === 0 ? (
            <div style={TYPOGRAPHY.HINT}>No probes yet.</div>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <TH>When</TH>
                  <TH>Kind</TH>
                  <TH>Result</TH>
                  <TH>RTT</TH>
                  <TH>Error</TH>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.id}>
                    <TD style={{ fontSize: 11.5 }}>{new Date(p.ts).toLocaleString()}</TD>
                    <TD>{p.kind}</TD>
                    <TD>
                      <StatusDot tone={p.ok ? "ok" : "danger"} label={p.ok ? "ok" : "fail"} style={{ marginRight: 6 }} />
                      {p.ok ? "ok" : "fail"}
                    </TD>
                    <TD style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                      {p.rttMs != null ? `${p.rttMs.toFixed(1)} ms` : "—"}
                    </TD>
                    <TD style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                      {p.errorMsg ?? ""}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
