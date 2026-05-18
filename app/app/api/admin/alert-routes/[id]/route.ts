import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { validateRoutePayload } from "@/lib/alert-route-validate"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import {
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

// Phase 7 Workstream A step 3 — per-route update + delete.
// PATCH replaces all editable fields; DELETE removes the route.
// Cascade-deleting dispatches is handled by the schema's onDelete
// behavior — actually, Fl_AlertDispatch.routeId is nullable + has
// no FK cascade (routes can be deleted without nuking history).
// So DELETE only removes the route row; historical dispatches stay
// with routeId=null + their original state.
// Phase 9 WS-B §4.1 — both verbs write to the audit chain.

export const dynamic = "force-dynamic"

export const PATCH = withAudit(
  { action: "alertRoute.update" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
  },
)

export const DELETE = withAudit(
  { action: "alertRoute.delete" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin()
    const { id } = await params
    const existing = await prisma.fl_AlertRoute.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "route not found" }, { status: 404 })

    // Phase 11 WS-B.3 — alert-route.delete is always gated (destructive
    // edit on shared infrastructure). approvalId via query string since
    // DELETE typically has no body.
    const approvalId = req.nextUrl.searchParams.get("approvalId") ?? undefined
    const gatedPayload = { id }
    const { hex: payloadHash } = hashPayload(gatedPayload)
    if (!approvalId) {
      const result = await requireApproval({
        action: "alert-route.delete",
        tenantName: existing.tenantName ?? "__global__",
        payload: gatedPayload,
        scope: id,
        requestedBy: session.email,
      })
      addAuditDetail(req, { approvalRequested: result.approvalId })
      return NextResponse.json(
        { status: "approval-required", approvalId: result.approvalId },
        { status: 202 },
      )
    }
    const consumed = await consumeApproval({
      approvalId,
      action: "alert-route.delete",
      payloadHash,
    })
    if (!consumed.ok) {
      return NextResponse.json({ error: consumed.reason }, { status: consumed.status })
    }
    addAuditDetail(req, { approvalConsumed: approvalId })

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
  },
)
