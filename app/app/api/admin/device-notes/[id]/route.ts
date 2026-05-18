import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"

export const dynamic = "force-dynamic"

export const PATCH = withAudit(
  { action: "deviceNote.update" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireSession()
    const { id } = await params
    const existing = await prisma.fl_DeviceNote.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: "note not found" }, { status: 404 })
    }
    const body = (await req.json().catch(() => ({}))) as { body?: string; isPinned?: boolean }
    if (body.body != null && body.body.length > 16_000) {
      return NextResponse.json({ error: "body must be ≤ 16,000 chars" }, { status: 400 })
    }
    await prisma.fl_DeviceNote.update({
      where: { id },
      data: {
        ...(body.body != null ? { body: body.body.trim() } : {}),
        ...(body.isPinned != null ? { isPinned: body.isPinned } : {}),
      },
    })
    return NextResponse.json({ ok: true })
  },
)

export const DELETE = withAudit(
  { action: "deviceNote.delete" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireSession()
    const { id } = await params
    // Soft-delete — retain historical context across staff turnover.
    await prisma.fl_DeviceNote.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  },
)
