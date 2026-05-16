import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { EmptyState as UiEmptyState } from "@/components/ui/EmptyState"
import { Chip } from "@/components/ui/Chip"

export const dynamic = "force-dynamic"

// Phase 7 Workstream A step 3 — alert routing list page.
// ADMIN-only. Routes are evaluated in priority order at write
// time (first match wins). Empty state guides the operator to
// create their first route.

interface Channel {
  type: string
  webhookUrl?: string
  toEmails?: string[]
}
interface MatchPredicate {
  severity?: string[] | string
  kindLike?: string
}

export default async function AlertRoutingListPage() {
  await requireAdmin()
  const routes = await prisma.fl_AlertRoute.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Alert routing
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: 720 }}>
              Where alerts go. Routes are evaluated in priority order
              (lowest number first); tenant-specific routes beat
              null-tenant ones. First match wins. When nothing matches,{" "}
              <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "12px" }}>
                FLEETHUB_DEFAULT_ALERT_WEBHOOK_URL
              </code>{" "}
              picks up the slack.
            </p>
          </div>
          <Link
            href="/setup/alert-routing/new"
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
            + New route
          </Link>
        </header>

        {routes.length === 0 ? (
          <EmptyState />
        ) : (
          <RoutesTable routes={routes} />
        )}
      </div>
    </AppShell>
  )
}

function RoutesTable({ routes }: { routes: Array<{
  id: string
  tenantName: string | null
  matchJson: string
  channelsJson: string
  dedupWindowMin: number
  priority: number
  isActive: boolean
}> }) {
  return (
    <div
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
        overflowX: "auto",
      }}
    >
      <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", fontSize: "12.5px" }}>
        <thead>
          <tr style={{ background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))" }}>
            <Th align="right">Priority</Th>
            <Th align="left">Tenant</Th>
            <Th align="left">Match</Th>
            <Th align="left">Channels</Th>
            <Th align="right">Dedup</Th>
            <Th align="center">Active</Th>
            <Th align="right">Edit</Th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => {
            let m: MatchPredicate = {}
            let ch: Channel[] = []
            try { m = JSON.parse(r.matchJson) as MatchPredicate } catch { /* shrug */ }
            try { ch = JSON.parse(r.channelsJson) as Channel[] } catch { /* shrug */ }
            return (
              <tr key={r.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                <Td align="right"><strong>{r.priority}</strong></Td>
                <Td align="left">{r.tenantName ?? <span style={{ color: "var(--color-text-muted)" }}>all tenants</span>}</Td>
                <Td align="left">{describeMatch(m)}</Td>
                <Td align="left">{describeChannels(ch)}</Td>
                <Td align="right">{r.dedupWindowMin}m</Td>
                <Td align="center">
                  <Chip tone={r.isActive ? "ok" : "neutral"}>
                    {r.isActive ? "active" : "off"}
                  </Chip>
                </Td>
                <Td align="right">
                  <Link href={`/setup/alert-routing/${r.id}`} style={{ color: "var(--color-accent, #F97316)", fontWeight: 600, textDecoration: "none" }}>
                    Edit
                  </Link>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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

function describeChannels(ch: Channel[]): React.ReactNode {
  if (ch.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>none</span>
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {ch.map((c, i) => (
        <span
          key={i}
          style={{
            padding: "1px 7px",
            fontSize: "10px",
            fontWeight: 600,
            borderRadius: 999,
            background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.18))",
            color: "var(--color-text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {c.type}
        </span>
      ))}
    </span>
  )
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return (
    <th style={{ padding: "8px 12px", textAlign: align, fontSize: "10px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {children}
    </th>
  )
}
function Td({ children, align }: { children: React.ReactNode; align: "left" | "right" | "center" }) {
  return <td style={{ padding: "10px 12px", textAlign: align, whiteSpace: "nowrap" }}>{children}</td>
}

function EmptyState() {
  return (
    <UiEmptyState
      body={
        <>
          No routes yet. Alerts will fall through to{" "}
          <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "12px" }}>
            FLEETHUB_DEFAULT_ALERT_WEBHOOK_URL
          </code>{" "}
          if set, otherwise be logged as{" "}
          <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "12px" }}>
            skipped-no-channel
          </code>
          . Click <strong>+ New route</strong> above to start.
        </>
      }
    />
  )
}
