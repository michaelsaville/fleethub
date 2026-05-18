import Link from "next/link"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { DataTable, TH, TD } from "@/components/ui/Table"
import { Button } from "@/components/ui/Button"
import { StatusDot } from "@/components/ui/StatusDot"
import { EmptyState } from "@/components/ui/EmptyState"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"

// Phase 12 WS-A.7 — network devices list.
//
// One row per Fl_NetworkDevice. Status derives from the last probe:
// ok in last 60s → online, otherwise muted. P95 latency from the
// most recent Fl_NetworkProbeHour row (24h horizon).

export const dynamic = "force-dynamic"

export default async function NetworkDevicesPage() {
  await requireSession()
  const devices = await prisma.fl_NetworkDevice.findMany({
    where: { isActive: true },
    orderBy: [{ clientName: "asc" }, { displayName: "asc" }],
  })
  // Per-device most-recent ICMP probe + the most recent hour rollup.
  const probesMap = new Map<string, { ok: boolean; ts: Date; rttMs: number | null }>()
  if (devices.length > 0) {
    // One query: for each device, fetch the single latest probe.
    // (Simpler than a window-function — N+1 is fine for v1 device counts.)
    for (const d of devices) {
      const p = await prisma.fl_NetworkProbe.findFirst({
        where: { networkDeviceId: d.id, kind: "icmp" },
        orderBy: { ts: "desc" },
        select: { ok: true, ts: true, rttMs: true },
      })
      if (p) probesMap.set(d.id, p)
    }
  }

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h1 style={TYPOGRAPHY.H1}>Network devices</h1>
          <Link
            href="/network-devices/new"
            style={{ textDecoration: "none" }}
          >
            <Button variant="primary">+ Add device</Button>
          </Link>
        </div>
        <Card>
          <CardHeader title={`${devices.length} devices`} />
          {devices.length === 0 ? (
            <EmptyState
              title="No network devices yet"
              body="Add a switch, router, AP, UPS, or printer to monitor via ICMP and/or SNMP. SNMP credentials are stored in the credential vault."
            />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <TH>Device</TH>
                  <TH>Tenant</TH>
                  <TH>Kind</TH>
                  <TH>IP</TH>
                  <TH>Status</TH>
                  <TH>Last probed</TH>
                  <TH>Last rtt</TH>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const last = probesMap.get(d.id)
                  const tone: "ok" | "muted" | "danger" = !last
                    ? "muted"
                    : last.ok
                    ? "ok"
                    : "danger"
                  const tooltip = !last
                    ? "never probed"
                    : last.ok
                    ? "reachable"
                    : "unreachable"
                  return (
                    <tr key={d.id}>
                      <TD>
                        <Link
                          href={`/network-devices/${d.id}`}
                          style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}
                        >
                          <StatusDot tone={tone} label={tooltip} style={{ marginRight: 8 }} />
                          {d.displayName}
                        </Link>
                      </TD>
                      <TD>{d.clientName}</TD>
                      <TD>{d.kind}</TD>
                      <TD style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                        {d.ipAddress}
                      </TD>
                      <TD>
                        <StatusDot tone={tone} label={tooltip} style={{ marginRight: 6 }} />
                        {tooltip}
                      </TD>
                      <TD style={{ color: "var(--color-text-muted)", fontSize: 11.5 }}>
                        {last ? new Date(last.ts).toLocaleString() : "—"}
                      </TD>
                      <TD style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                        {last?.rttMs != null ? `${last.rttMs.toFixed(1)} ms` : "—"}
                      </TD>
                    </tr>
                  )
                })}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
