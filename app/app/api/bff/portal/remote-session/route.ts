import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { verifyHmac } from "@/lib/bff-hmac"
import { controlrConfigured, controlrLogonTokensEnabled, createControlRLogonToken, resolveControlRDeviceId } from "@/lib/controlr"

// Customer self-service remote access (2026-09-13) — a portal user opens a
// ControlR session to a device they've been granted. Gates, in order:
// HMAC · tenant portalEnabled + portalRemoteEnabled · an unrevoked,
// unexpired Fl_DeviceShare for (device, email) · device known to ControlR
// and online. Then an Fl_RemoteSession (origin "portal", operatorEmail =
// the customer) + a single-use ControlR logon token for THAT device only,
// audited on both sides (sessionCorrelationId = our session id).
//
// Note (ControlR 0.27.6): the token grants whatever the ControlR device
// page offers (remote control, terminal, files). 0.28 adds per-token
// permissions — when we're on it, pass ["remote-control"] here.

export const dynamic = "force-dynamic"
const TOKEN_TTL_MIN = 5

interface Body {
  portalUserId?: string
  portalEmail?: string
  portalUserName?: string | null
  clientName?: string
  deviceId?: string
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
  const deviceId = body.deviceId?.trim()
  if (!clientName || !email || !deviceId) return NextResponse.json({ error: "clientName, portalEmail, deviceId required" }, { status: 400 })

  const deny = async (reason: string, status: number) => {
    await writeAudit({
      actorEmail: email,
      clientName,
      deviceId,
      action: "portal.remote.session.denied",
      outcome: "error",
      detail: { reason, portalUserId: body.portalUserId ?? null },
    }).catch(() => undefined)
    return NextResponse.json({ error: reason }, { status })
  }

  if (!controlrConfigured()) return deny("Remote access is not available right now.", 503)
  const tenant = await prisma.fl_Tenant.findUnique({ where: { name: clientName }, select: { portalEnabled: true, portalRemoteEnabled: true } })
  if (!tenant?.portalEnabled || !tenant.portalRemoteEnabled) return deny("Remote access isn't enabled for your company.", 403)

  const device = await prisma.fl_Device.findUnique({
    where: { id: deviceId },
    select: { id: true, hostname: true, clientName: true, isActive: true, controlrDeviceId: true },
  })
  if (!device || !device.isActive || device.clientName !== clientName) return deny("Device not found.", 404)

  const share = await prisma.fl_DeviceShare.findFirst({
    where: { deviceId, portalEmail: email, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  })
  if (!share) return deny("You don't have remote access to this device.", 403)

  const controlr = await resolveControlRDeviceId(device)
  if (!controlr) return deny("This device isn't set up for remote access yet — contact PCC2K.", 409)
  if (controlr.device && !controlr.device.isOnline) return deny(`${device.hostname} is offline right now.`, 409)

  const session = await prisma.fl_RemoteSession.create({
    data: {
      deviceId,
      operatorEmail: email,
      provider: "controlr",
      origin: "portal",
      state: "in-progress",
      startedAt: new Date(),
      justification: `Customer self-service (portal share ${share.id})`,
    },
    select: { id: true },
  })

  let url: string
  let expiresAt: string | null = null
  try {
    if (controlrLogonTokensEnabled()) {
      const minted = await createControlRLogonToken({
        controlrDeviceId: controlr.controlrDeviceId,
        operatorEmail: `portal+${email}`,
        operatorName: body.portalUserName ? `${body.portalUserName} (${clientName})` : `${email} (${clientName})`,
        sessionId: session.id,
        expirationMinutes: TOKEN_TTL_MIN,
      })
      url = minted.deviceAccessUrl
      expiresAt = minted.expiresAt
    } else {
      // Without tokens the customer would need their own ControlR login —
      // that is exactly what this feature exists to avoid. Refuse.
      throw new Error("logon tokens disabled")
    }
  } catch (e) {
    await prisma.fl_RemoteSession.update({ where: { id: session.id }, data: { state: "revoked", endedAt: new Date() } })
    return deny(`Could not start the session: ${e instanceof Error ? e.message : String(e)}`, 502)
  }

  await Promise.all([
    prisma.fl_RemoteSession.update({ where: { id: session.id }, data: { accessTokenExpiresAt: expiresAt ? new Date(expiresAt) : null } }),
    prisma.fl_DeviceShare.update({ where: { id: share.id }, data: { lastUsedAt: new Date(), useCount: { increment: 1 } } }),
    writeAudit({
      actorEmail: email,
      clientName,
      deviceId,
      action: "portal.remote.session.opened",
      outcome: "ok",
      detail: { sessionId: session.id, shareId: share.id, portalUserId: body.portalUserId ?? null, hostname: device.hostname, ttlMin: TOKEN_TTL_MIN },
    }),
  ])
  return NextResponse.json({ sessionId: session.id, url, expiresAt, hostname: device.hostname })
}
