import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { verifyHmac } from "@/lib/bff-hmac"

// Phase 7 Workstream D — Super Portal → FleetHub BFF: fleet
// summary card data. The portal verifies the
// (portalUserId, clientName) link on its side before calling;
// FleetHub trusts the call once the HMAC validates and the
// tenant is portal-enabled.
//
// Sanitized output: counts only. Alert TITLES, IPs, inventory
// detail never leave FleetHub through this route — customer
// portal is read-only by design.

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
    select: { portalEnabled: true },
  })
  if (!tenant?.portalEnabled) {
    return NextResponse.json({ error: "portal not enabled for this client" }, { status: 403 })
  }

  const offlineCutoff = new Date(Date.now() - 24 * 60 * 60_000)
  const [deviceTotal, deviceOnline, hostsOffline24h, openAlerts, latestPatchScan, latestReport] = await Promise.all([
    prisma.fl_Device.count({ where: { clientName, isActive: true } }),
    prisma.fl_Device.count({ where: { clientName, isActive: true, isOnline: true } }),
    prisma.fl_Device.count({ where: { clientName, isActive: true, lastSeenAt: { lt: offlineCutoff } } }),
    prisma.fl_Alert.count({ where: { clientName, state: "open" } }),
    prisma.fl_Device.findFirst({
      where: { clientName, isActive: true, lastSeenAt: { not: null } },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true },
    }),
    prisma.fl_Report.findFirst({
      where: { tenantName: clientName, state: { in: ["ready", "delivered"] } },
      orderBy: { generatedAt: "desc" },
      select: { id: true, kind: true, generatedAt: true },
    }),
  ])

  await writeAudit({
    clientName,
    action: "portal.fleet.summary.viewed",
    outcome: "ok",
    detail: { portalUserId },
  }).catch(() => undefined)

  return NextResponse.json({
    deviceCount: deviceTotal,
    onlineCount: deviceOnline,
    hostsOffline24h,
    openAlerts,
    latestActivityAt: latestPatchScan?.lastSeenAt?.toISOString() ?? null,
    latestReport: latestReport
      ? { id: latestReport.id, kind: latestReport.kind, generatedAt: latestReport.generatedAt?.toISOString() ?? null }
      : null,
  })
}
