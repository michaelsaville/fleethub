import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { verifyHmac } from "@/lib/bff-hmac"

// Phase 7 Workstream D — fleet device list for the customer
// portal. Sanitized: hostname, OS family, online state,
// last-seen, role. No IPs, no inventory detail, no agent ids.

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

  const rows = await prisma.fl_Device.findMany({
    where: { clientName, isActive: true },
    orderBy: [{ isOnline: "desc" }, { hostname: "asc" }],
    take: 500,
    select: {
      id: true,
      hostname: true,
      os: true,
      isOnline: true,
      lastSeenAt: true,
      role: true,
    },
  })

  await writeAudit({
    clientName,
    action: "portal.fleet.devices.viewed",
    outcome: "ok",
    detail: { portalUserId, count: rows.length },
  }).catch(() => undefined)

  return NextResponse.json({
    devices: rows.map((d) => ({
      id: d.id,
      hostname: d.hostname,
      os: d.os,
      isOnline: d.isOnline,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      role: d.role,
    })),
  })
}
