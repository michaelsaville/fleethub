import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"

// Phase 9 WS-C §5.1 — per-group update + delete.

export const dynamic = "force-dynamic"

export const PATCH = withAudit(
  { action: "deviceGroup.update" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    const existing = await prisma.fl_DeviceGroup.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "group not found" }, { status: 404 })

    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      rql?: string | null
      pinnedDeviceIds?: string[]
    }
    await prisma.fl_DeviceGroup.update({
      where: { id },
      data: {
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        rql: body.rql === undefined ? existing.rql : body.rql?.trim() || null,
        pinnedDeviceIdsJson:
          body.pinnedDeviceIds && body.pinnedDeviceIds.length > 0
            ? JSON.stringify(body.pinnedDeviceIds)
            : body.pinnedDeviceIds && body.pinnedDeviceIds.length === 0
              ? null
              : existing.pinnedDeviceIdsJson,
      },
    })
    return NextResponse.json({ ok: true })
  },
)

export const DELETE = withAudit(
  { action: "deviceGroup.delete" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    const existing = await prisma.fl_DeviceGroup.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "group not found" }, { status: 404 })
    // Check whether any monitors reference this group; refuse delete
    // (operator must unbind first) to avoid silent target-set loss.
    const ref = await prisma.fl_Monitor.findFirst({
      where: { scopeGroupId: id },
      select: { id: true, name: true },
    })
    if (ref) {
      return NextResponse.json(
        { error: `monitor "${ref.name}" still scoped to this group — unbind it first` },
        { status: 409 },
      )
    }
    await prisma.fl_DeviceGroup.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  },
)
