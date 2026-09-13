import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRoleResponse } from "@/lib/authz"
import { writeAudit } from "@/lib/audit"

// Customer self-service remote access (2026-09-13) — staff manage which
// portal users may remote into a device.
//   GET    → active shares + suggested emails (TicketHub contacts of the
//            client + existing portal users linked to it)
//   POST   { portalEmail, note?, expiresAt? } → grant (idempotent per email)
//   DELETE { shareId } → revoke (row kept for audit)
// ADMIN only: this is handing a customer a door into a machine.

export const dynamic = "force-dynamic"

async function deviceFor(id: string) {
  return prisma.fl_Device.findUnique({ where: { id }, select: { id: true, hostname: true, clientName: true } })
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRoleResponse("TECH")
  if ("response" in gate) return gate.response
  const { id } = await ctx.params
  const device = await deviceFor(id)
  if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 })

  const [shares, contacts, portalUsers, tenant] = await Promise.all([
    prisma.fl_DeviceShare.findMany({
      where: { deviceId: id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.$queryRaw<Array<{ email: string; name: string; jobTitle: string | null }>>`
      SELECT lower(k.email) AS email, k."firstName" || ' ' || k."lastName" AS name, k."jobTitle"
        FROM tickethub.th_contacts k JOIN tickethub.th_clients c ON c.id = k."clientId"
       WHERE lower(c.name) = lower(${device.clientName}) AND k."isActive" AND k.email IS NOT NULL AND k.email <> ''
       ORDER BY k."isPrimary" DESC, k."lastName"
       LIMIT 40
    `,
    prisma.$queryRaw<Array<{ email: string; name: string }>>`
      SELECT DISTINCT lower(u.email) AS email, u.name
        FROM portal.portal_users u
        JOIN portal.portal_user_client_links l ON l."portalUserId" = u.id
        JOIN public."Client" dc ON dc.id = l."clientId"
       WHERE lower(dc.name) = lower(${device.clientName}) AND u."isActive"
       LIMIT 40
    `.catch(() => [] as Array<{ email: string; name: string }>),
    prisma.fl_Tenant.findUnique({ where: { name: device.clientName }, select: { portalEnabled: true, portalRemoteEnabled: true } }),
  ])
  const portalByEmail = new Map(portalUsers.map((u) => [u.email, u]))
  const suggestions = contacts.map((c) => ({
    email: c.email,
    name: c.name,
    jobTitle: c.jobTitle,
    hasPortalLogin: portalByEmail.has(c.email),
  }))
  for (const u of portalUsers) {
    if (!suggestions.some((s) => s.email === u.email)) suggestions.push({ email: u.email, name: u.name, jobTitle: null, hasPortalLogin: true })
  }
  return NextResponse.json({
    device,
    tenant: { portalEnabled: tenant?.portalEnabled ?? false, portalRemoteEnabled: tenant?.portalRemoteEnabled ?? false },
    shares: shares.map((s) => ({ ...s, hasPortalLogin: portalByEmail.has(s.portalEmail) })),
    suggestions,
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRoleResponse("ADMIN")
  if ("response" in gate) return gate.response
  const { id } = await ctx.params
  const device = await deviceFor(id)
  if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as { portalEmail?: string; note?: string; expiresAt?: string | null }
  const email = body.portalEmail?.trim().toLowerCase() ?? ""
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "valid email required" }, { status: 400 })
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return NextResponse.json({ error: "bad expiresAt" }, { status: 400 })

  const existing = await prisma.fl_DeviceShare.findFirst({ where: { deviceId: id, portalEmail: email, revokedAt: null } })
  const share =
    existing ??
    (await prisma.fl_DeviceShare.create({
      data: { deviceId: id, portalEmail: email, grantedByEmail: gate.ctx.email, note: body.note?.trim() || null, expiresAt },
    }))
  await writeAudit({
    actorEmail: gate.ctx.email,
    clientName: device.clientName,
    deviceId: id,
    action: "portal.remote.share.granted",
    outcome: "ok",
    detail: { shareId: share.id, portalEmail: email, hostname: device.hostname, expiresAt: expiresAt?.toISOString() ?? null, alreadyShared: !!existing },
  })
  return NextResponse.json({ share }, { status: existing ? 200 : 201 })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireRoleResponse("ADMIN")
  if ("response" in gate) return gate.response
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { shareId?: string }
  if (!body.shareId) return NextResponse.json({ error: "shareId required" }, { status: 400 })
  const share = await prisma.fl_DeviceShare.findFirst({ where: { id: body.shareId, deviceId: id, revokedAt: null }, include: { device: { select: { clientName: true, hostname: true } } } })
  if (!share) return NextResponse.json({ error: "share not found" }, { status: 404 })
  await prisma.fl_DeviceShare.update({ where: { id: share.id }, data: { revokedAt: new Date(), revokedByEmail: gate.ctx.email } })
  await writeAudit({
    actorEmail: gate.ctx.email,
    clientName: share.device.clientName,
    deviceId: id,
    action: "portal.remote.share.revoked",
    outcome: "ok",
    detail: { shareId: share.id, portalEmail: share.portalEmail, hostname: share.device.hostname },
  })
  return NextResponse.json({ ok: true })
}
