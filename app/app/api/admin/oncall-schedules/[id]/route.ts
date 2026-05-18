import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { validateSchedulePayload } from "@/lib/oncall-validate"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import {
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

export const dynamic = "force-dynamic"

export const PATCH = withAudit(
  { action: "oncallSchedule.update" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    const existing = await prisma.fl_OncallSchedule.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "schedule not found" }, { status: 404 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const v = validateSchedulePayload(body)
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

    await prisma.fl_OncallSchedule.update({
      where: { id },
      data: {
        name: v.name,
        rotationJson: JSON.stringify(v.rotation),
        overridesJson: v.overrides.length > 0 ? JSON.stringify(v.overrides) : null,
        isActive: v.isActive,
      },
    })
    return NextResponse.json({ ok: true })
  },
)

export const DELETE = withAudit(
  { action: "oncallSchedule.delete" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin()
    const { id } = await params

    // Phase 11 WS-B.3 — oncall-schedule.delete is always gated.
    const approvalId = req.nextUrl.searchParams.get("approvalId") ?? undefined
    const existing = await prisma.fl_OncallSchedule.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "schedule not found" }, { status: 404 })
    const gatedPayload = { id }
    const { hex: payloadHash } = hashPayload(gatedPayload)
    if (!approvalId) {
      const result = await requireApproval({
        action: "oncall-schedule.delete",
        tenantName: "__global__",
        payload: gatedPayload,
        scope: existing.name,
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
      action: "oncall-schedule.delete",
      payloadHash,
    })
    if (!consumed.ok) {
      return NextResponse.json({ error: consumed.reason }, { status: consumed.status })
    }
    addAuditDetail(req, { approvalConsumed: approvalId })

    // Check whether any active alert routes reference this schedule
    // before deleting — orphaning a channel mid-flight is a silent
    // failure mode operators won't notice until an alert misroutes.
    const routes = await prisma.fl_AlertRoute.findMany({
      where: { isActive: true },
      select: { id: true, channelsJson: true, escalationJson: true },
    })
    for (const r of routes) {
      if (referencesSchedule(r.channelsJson, id)) {
        return NextResponse.json(
          { error: `route ${r.id} still references this schedule on its channels — unset the route's oncallScheduleId first` },
          { status: 409 },
        )
      }
      if (r.escalationJson && referencesSchedule(r.escalationJson, id)) {
        return NextResponse.json(
          { error: `route ${r.id} still references this schedule in its escalation chain — unset it first` },
          { status: 409 },
        )
      }
    }
    await prisma.fl_OncallSchedule.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  },
)

function referencesSchedule(json: string, scheduleId: string): boolean {
  // Cheap substring check is fine — the id is a cuid, very low
  // probability of false-positive substring match against unrelated
  // JSON content.
  return json.includes(scheduleId)
}
