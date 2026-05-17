import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { SUPPORTED_SOURCES } from "@/lib/inbound-mappers"
import { InboundWebhooksClient } from "./InboundWebhooksClient"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 6 — inbound webhooks setup page.
// List + per-row reveal-token + active toggle + delete + new-
// webhook form. Tokens never appear on initial render; they're
// fetched lazily when the operator clicks Reveal.

interface WebhookRow {
  id: string
  name: string
  tenantName: string
  source: string
  isActive: boolean
  lastFiredAt: Date | null
  lastErrorAt: Date | null
  lastError: string | null
  fireCount: number
  errorCount: number
  createdAt: Date
}

export default async function InboundWebhooksPage() {
  await requireAdmin()

  const rows = await prisma.$queryRaw<WebhookRow[]>`
    SELECT id, name, "tenantName", source, "isActive",
           "lastFiredAt", "lastErrorAt", "lastError",
           "fireCount", "errorCount", "createdAt"
    FROM fleethub.fl_inbound_webhooks
    ORDER BY "isActive" DESC, name ASC
  `

  const tenants = await loadTenantOptions()
  const publicUrl = (process.env.FLEETHUB_PUBLIC_URL || "https://fleethub.pcc2k.com").replace(/\/$/, "")

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <header>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            <Link href="/setup" style={{ color: "inherit", textDecoration: "none" }}>← Setup</Link>
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Inbound webhooks
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: 760 }}>
            Per-tool URLs that third parties (UptimeRobot, Datadog, Sentry,
            custom scripts) post alerts to. The URL token is the bearer
            credential — anyone with the URL can post. Treat it like a
            password: rotate by deleting + re-adding.
          </p>
        </header>

        <InboundWebhooksClient
          rows={rows.map((r) => ({
            ...r,
            lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
            lastErrorAt: r.lastErrorAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          }))}
          tenants={tenants}
          sources={SUPPORTED_SOURCES}
          publicUrl={publicUrl}
        />
      </div>
    </AppShell>
  )
}

async function loadTenantOptions(): Promise<string[]> {
  const [tenants, devClients] = await Promise.all([
    prisma.fl_Tenant.findMany({ select: { name: true } }),
    prisma.fl_Device.findMany({
      where: { isActive: true },
      distinct: ["clientName"],
      select: { clientName: true },
    }),
  ])
  const names = new Set<string>()
  for (const t of tenants) names.add(t.name)
  for (const d of devClients) names.add(d.clientName)
  return [...names].sort((a, b) => a.localeCompare(b))
}
