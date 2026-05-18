import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// PATCH /api/devices/[id]
// Body: { friendlyName?: string | null }
// Currently the only editable field is friendlyName (operator label).
// Trim + collapse-empty-to-null so the search index doesn't trip on
// blank strings.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    friendlyName?: string | null
  }

  const data: { friendlyName?: string | null } = {}
  if ("friendlyName" in body) {
    const trimmed = typeof body.friendlyName === "string" ? body.friendlyName.trim() : ""
    data.friendlyName = trimmed === "" ? null : trimmed.slice(0, 120)
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no editable fields supplied" }, { status: 400 })
  }

  const before = await prisma.fl_Device.findUnique({
    where: { id },
    select: { id: true, clientName: true, hostname: true, friendlyName: true },
  })
  if (!before) {
    return NextResponse.json({ error: "device not found" }, { status: 404 })
  }

  const after = await prisma.fl_Device.update({
    where: { id },
    data,
    select: { id: true, friendlyName: true, hostname: true, clientName: true },
  })

  await writeAudit({
    actorEmail: session.email,
    clientName: after.clientName,
    deviceId: after.id,
    action: "device.update",
    outcome: "ok",
    detail: {
      changes: {
        friendlyName: { from: before.friendlyName, to: after.friendlyName },
      },
    },
  }).catch(() => {})

  return NextResponse.json(after)
}
