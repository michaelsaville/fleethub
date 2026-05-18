import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"

// Phase 9 WS-C §5.1 — Fl_DeviceGroup CRUD (collection).

export const dynamic = "force-dynamic"

export const POST = withAudit({ action: "deviceGroup.create" }, async (req: NextRequest) => {
  const session = await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as {
    tenantName?: string
    name?: string
    rql?: string | null
    pinnedDeviceIds?: string[]
  }
  if (!body.tenantName?.trim() || !body.name?.trim()) {
    return NextResponse.json({ error: "tenantName + name required" }, { status: 400 })
  }
  if ((!body.rql || !body.rql.trim()) && (!body.pinnedDeviceIds || body.pinnedDeviceIds.length === 0)) {
    return NextResponse.json(
      { error: "either rql or pinnedDeviceIds must be non-empty" },
      { status: 400 },
    )
  }
  const created = await prisma.fl_DeviceGroup.create({
    data: {
      tenantName: body.tenantName,
      name: body.name,
      rql: body.rql?.trim() || null,
      pinnedDeviceIdsJson:
        body.pinnedDeviceIds && body.pinnedDeviceIds.length > 0
          ? JSON.stringify(body.pinnedDeviceIds)
          : null,
      createdBy: session.email,
    },
    select: { id: true },
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
})
