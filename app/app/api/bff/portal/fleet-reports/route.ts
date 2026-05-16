import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { verifyHmac } from "@/lib/bff-hmac"

// Phase 7 Workstream D — historical-report list for the customer
// portal. Filtered to ready/delivered reports younger than
// Fl_Tenant.portalReportMaxAgeDays (default 90).
//
// Download URLs are NOT included in this list — they require the
// customer-portal-side download handler to mint a signed link
// against the FleetHub /api/reports/[id]/download surface.
// Step 6 of WS-D wires that.

export const dynamic = "force-dynamic"

interface Body {
  portalUserId?: string
  clientName?: string
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const verify = verifyHmac(
    rawBody,
    req.headers.get("x-portal-signature"),
    req.headers.get("x-portal-timestamp"),
    process.env.PORTAL_BFF_SECRET ?? "",
  )
  if (!verify.ok) return NextResponse.json({ error: verify.reason }, { status: verify.status })

  let body: Body
  try { body = JSON.parse(rawBody) as Body } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const clientName = body.clientName?.trim()
  const portalUserId = body.portalUserId?.trim() ?? ""
  if (!clientName) return NextResponse.json({ error: "clientName required" }, { status: 400 })

  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: clientName },
    select: { portalEnabled: true, portalReportMaxAgeDays: true },
  })
  if (!tenant?.portalEnabled) {
    return NextResponse.json({ error: "portal not enabled for this client" }, { status: 403 })
  }

  const maxAgeDays = Math.max(1, tenant.portalReportMaxAgeDays)
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000)

  const reports = await prisma.fl_Report.findMany({
    where: {
      tenantName: clientName,
      state: { in: ["ready", "delivered"] },
      generatedAt: { gte: cutoff },
    },
    orderBy: { generatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      kind: true,
      audience: true,
      format: true,
      generatedAt: true,
      asOf: true,
      startDate: true,
      endDate: true,
    },
  })

  await writeAudit({
    clientName,
    action: "portal.fleet.reports.viewed",
    outcome: "ok",
    detail: { portalUserId, count: reports.length, maxAgeDays },
  }).catch(() => undefined)

  return NextResponse.json({
    reports: reports.map((r) => ({
      id: r.id,
      kind: r.kind,
      audience: r.audience,
      format: r.format,
      generatedAt: r.generatedAt?.toISOString() ?? null,
      asOf: r.asOf?.toISOString() ?? null,
      startDate: r.startDate?.toISOString() ?? null,
      endDate: r.endDate?.toISOString() ?? null,
    })),
    maxAgeDays,
  })
}
