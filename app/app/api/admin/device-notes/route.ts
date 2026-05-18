import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"

// Phase 10 WS-C §5.6 — Fl_DeviceNote CRUD. POST creates;
// list-by-device is read via /devices/[id] server props, no GET
// here. Per-id PATCH/DELETE in [id]/route.ts.

export const dynamic = "force-dynamic"

export const POST = withAudit({ action: "deviceNote.create" }, async (req: NextRequest) => {
  const session = await requireSession()
  const body = (await req.json().catch(() => ({}))) as {
    deviceId?: string
    body?: string
    isPinned?: boolean
  }
  if (!body.deviceId?.trim() || !body.body?.trim()) {
    return NextResponse.json({ error: "deviceId + body required" }, { status: 400 })
  }
  if (body.body.length > 16_000) {
    return NextResponse.json({ error: "body must be ≤ 16,000 chars" }, { status: 400 })
  }
  const device = await prisma.fl_Device.findUnique({
    where: { id: body.deviceId },
    select: { id: true },
  })
  if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 })
  const created = await prisma.fl_DeviceNote.create({
    data: {
      deviceId: body.deviceId,
      body: body.body.trim(),
      isPinned: body.isPinned ?? false,
      createdBy: session.email,
    },
    select: { id: true },
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
})
