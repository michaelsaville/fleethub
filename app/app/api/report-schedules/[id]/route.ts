import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSession()
  const { id } = await params
  const existing = await prisma.fl_ReportSchedule.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 })
  await prisma.fl_ReportSchedule.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

// Toggle isActive. v1 only allows pausing/unpausing — full edit is
// delete+recreate per the schedule API contract.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSession()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { isActive?: boolean }
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive (boolean) required" }, { status: 400 })
  }
  const updated = await prisma.fl_ReportSchedule.update({
    where: { id },
    data: { isActive: body.isActive },
  })
  return NextResponse.json(updated)
}
