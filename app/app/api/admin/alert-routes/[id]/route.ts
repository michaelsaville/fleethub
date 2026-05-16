import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { validateRoutePayload } from "@/lib/alert-route-validate"

// Phase 7 Workstream A step 3 — per-route update + delete.
// PATCH replaces all editable fields; DELETE removes the route.
// Cascade-deleting dispatches is handled by the schema's onDelete
// behavior — actually, Fl_AlertDispatch.routeId is nullable + has
// no FK cascade (routes can be deleted without nuking history).
// So DELETE only removes the route row; historical dispatches stay
// with routeId=null + their original state.

export const dynamic = "force-dynamic"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const existing = await prisma.fl_AlertRoute.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "route not found" }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const v = validateRoutePayload(body)
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

  await prisma.fl_AlertRoute.update({
    where: { id },
    data: {
      tenantName: v.tenantName,
      matchJson: JSON.stringify(v.match),
      channelsJson: JSON.stringify(v.channels),
      escalationJson: v.escalation.length > 0 ? JSON.stringify(v.escalation) : null,
      dedupWindowMin: v.dedupWindowMin,
      isActive: v.isActive,
      priority: v.priority,
    },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const existing = await prisma.fl_AlertRoute.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "route not found" }, { status: 404 })

  // Detach existing dispatch rows from the route so historical
  // dispatches keep their channel/state but their FK reference is
  // cleared. Fl_AlertDispatch.routeId is already nullable. Also
  // null out escalateAt — a detached dispatch can't be escalated
  // (the cron has no chain to consult).
  await prisma.fl_AlertDispatch.updateMany({
    where: { routeId: id },
    data: { routeId: null, escalateAt: null },
  })
  await prisma.fl_AlertRoute.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
