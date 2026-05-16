import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import AlertRouteForm from "../AlertRouteForm"

export const dynamic = "force-dynamic"

type Severity = "critical" | "warn" | "info"

interface StoredMatch {
  severity?: string[] | string
  kindLike?: string
}
interface StoredChannel {
  type: string
  webhookUrl?: string
  toEmails?: string[]
  ccEmails?: string[]
  phoneNumbers?: string[]
  integrationKey?: string
  oncallScheduleId?: string
}
interface StoredEscalationStep {
  afterMin?: number
  channels?: StoredChannel[]
}

function hydrateChannel(c: StoredChannel) {
  return {
    type: c.type as "slack" | "teams" | "email" | "sms" | "pagerduty" | "ticket",
    webhookUrl: c.webhookUrl ?? "",
    toEmails: (c.toEmails ?? []).join(", "),
    ccEmails: (c.ccEmails ?? []).join(", "),
    phoneNumbers: (c.phoneNumbers ?? []).join(", "),
    integrationKey: c.integrationKey ?? "",
    oncallScheduleId: c.oncallScheduleId ?? "",
  }
}

export default async function EditAlertRoutePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const route = await prisma.fl_AlertRoute.findUnique({ where: { id } })
  if (!route) notFound()

  const [tenantOptions, oncallOptions] = await Promise.all([
    loadTenantOptions(),
    prisma.fl_OncallSchedule.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])

  let parsedMatch: StoredMatch = {}
  let parsedChannels: StoredChannel[] = []
  try { parsedMatch = JSON.parse(route.matchJson) as StoredMatch } catch { /* shrug */ }
  try { parsedChannels = JSON.parse(route.channelsJson) as StoredChannel[] } catch { /* shrug */ }

  const severityIn = parsedMatch.severity
  const severity: Severity[] = []
  if (Array.isArray(severityIn)) {
    for (const s of severityIn) {
      if (s === "critical" || s === "warn" || s === "info") severity.push(s)
    }
  } else if (severityIn === "critical" || severityIn === "warn" || severityIn === "info") {
    severity.push(severityIn)
  }

  const channels = parsedChannels
    .filter((c) => c.type === "slack" || c.type === "teams" || c.type === "email" || c.type === "sms" || c.type === "pagerduty" || c.type === "ticket")
    .map(hydrateChannel)

  let parsedEscalation: StoredEscalationStep[] = []
  try {
    if (route.escalationJson) parsedEscalation = JSON.parse(route.escalationJson) as StoredEscalationStep[]
  } catch { /* shrug */ }
  const escalation = parsedEscalation
    .filter((s) => typeof s.afterMin === "number" && Array.isArray(s.channels))
    .map((s) => ({
      afterMin: s.afterMin!,
      channels: (s.channels ?? [])
        .filter((c) => c.type === "slack" || c.type === "teams" || c.type === "email" || c.type === "sms" || c.type === "pagerduty" || c.type === "ticket")
        .map(hydrateChannel),
    }))

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: 760 }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Edit alert route
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
            {route.id}
          </p>
        </header>
        <AlertRouteForm
          initial={{
            id: route.id,
            tenantName: route.tenantName,
            severity,
            kindLike: parsedMatch.kindLike ?? "",
            channels,
            escalation,
            dedupWindowMin: route.dedupWindowMin,
            priority: route.priority,
            isActive: route.isActive,
          }}
          tenantOptions={tenantOptions}
          oncallOptions={oncallOptions}
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
