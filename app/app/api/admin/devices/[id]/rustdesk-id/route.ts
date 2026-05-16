import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { writeAudit } from "@/lib/audit"

// Phase 7 Workstream C — set / clear Fl_Device.rustdeskId. ADMIN
// only because the peer id determines which target a "Remote in"
// click connects to; a wrong id sends an operator to the wrong
// host without realizing.
//
// Body: { rustdeskId: string | null }. Empty string clears.

export const dynamic = "force-dynamic"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin()
  const { id } = await params
  const device = await prisma.fl_Device.findUnique({
    where: { id },
    select: { id: true, hostname: true, clientName: true, rustdeskId: true },
  })
  if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { rustdeskId?: unknown }
  let next: string | null = null
  if (typeof body.rustdeskId === "string") {
    const trimmed = body.rustdeskId.trim()
    if (trimmed.length === 0) {
      next = null
    } else {
      // RustDesk peer ids are typically 9-10 digit numerics, but
      // newer self-hosted installs allow longer alphanumeric. Be
      // lenient on shape, just enforce a sane max length.
      if (trimmed.length > 64) {
        return NextResponse.json({ error: "rustdeskId max length 64" }, { status: 400 })
      }
      next = trimmed
    }
  } else if (body.rustdeskId === null) {
    next = null
  } else {
    return NextResponse.json({ error: "rustdeskId must be a string or null" }, { status: 400 })
  }

  await prisma.fl_Device.update({
    where: { id },
    data: { rustdeskId: next },
  })
  await writeAudit({
    actorEmail: ctx.email,
    clientName: device.clientName,
    deviceId: device.id,
    action: next ? "device.rustdesk_id.set" : "device.rustdesk_id.cleared",
    outcome: "ok",
    detail: { hostname: device.hostname, before: device.rustdeskId, after: next },
  })
  return NextResponse.json({ ok: true, rustdeskId: next })
}
