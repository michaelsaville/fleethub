import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyHmac } from "@/lib/bff-hmac"

// Customer self-service remote access (2026-09-13) — which of the
// client's devices THIS portal user may remote into. The portal's
// /fleet/devices page uses it to decide where to show the button.
// HMAC-gated like every /api/bff/portal/* route.

export const dynamic = "force-dynamic"

interface Body {
  portalUserId?: string
  portalEmail?: string
  clientName?: string
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const verify = verifyHmac(rawBody, req.headers.get("x-portal-signature"), req.headers.get("x-portal-timestamp"), process.env.PORTAL_BFF_SECRET ?? "")
  if (!verify.ok) return NextResponse.json({ error: verify.reason }, { status: verify.status })
  let body: Body
  try {
    body = JSON.parse(rawBody) as Body
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const clientName = body.clientName?.trim()
  const email = body.portalEmail?.trim().toLowerCase()
  if (!clientName || !email) return NextResponse.json({ error: "clientName and portalEmail required" }, { status: 400 })

  const tenant = await prisma.fl_Tenant.findUnique({ where: { name: clientName }, select: { portalEnabled: true, portalRemoteEnabled: true } })
  if (!tenant?.portalEnabled || !tenant.portalRemoteEnabled) return NextResponse.json({ enabled: false, deviceIds: [] })

  const shares = await prisma.fl_DeviceShare.findMany({
    where: {
      portalEmail: email,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      device: { clientName, isActive: true },
    },
    select: { deviceId: true },
  })
  return NextResponse.json({ enabled: true, deviceIds: shares.map((s) => s.deviceId) })
}
