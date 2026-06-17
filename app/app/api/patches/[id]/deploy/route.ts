import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRoleResponse } from "@/lib/authz"
import { dispatchPatchDeploy } from "@/lib/patch-deploy"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { resolveGroupTargets } from "@/lib/targeting"
import {
  shouldRequireApproval,
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

// POST /api/patches/[id]/deploy
// Body: {
//   deviceIds?: string[],   // OR
//   groupId?: string,       // Phase 10 WS-A §3.5
//   dryRun: boolean, rebootPolicy?: string
// }
//
// Operator clicks Deploy on /patches/[id]; the patch must already be in
// approvalState="approved" (gated server-side in dispatchPatchDeploy).
// Per AGENT-PROTOCOL §14, dryRun defaults to true — UI must explicitly
// set false and the operator must opt in.
export const POST = withAudit(
  { action: "patch.deploy" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    // SEC-2 — patch deployment executes code on endpoints; TECH+ only.
    const gateAuth = await requireRoleResponse("TECH")
    if ("response" in gateAuth) return gateAuth.response
    const session = gateAuth.ctx
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      deviceIds?: string[]
      groupId?: string
      dryRun?: boolean
      rebootPolicy?: string
      approvalId?: string
    }
    let deviceIds = body.deviceIds ?? []
    if (deviceIds.length === 0 && body.groupId) {
      const resolved = await resolveGroupTargets(body.groupId)
      deviceIds = resolved.map((d) => d.id)
      if (deviceIds.length === 0) {
        return NextResponse.json(
          { error: `group ${body.groupId} resolves to 0 active devices` },
          { status: 400 },
        )
      }
    }
    if (deviceIds.length === 0) {
      return NextResponse.json(
        { error: "deviceIds[] or groupId required" },
        { status: 400 },
      )
    }

    // SEC-3 — gate bulk patch fan-out on the tenant's bulk threshold.
    const targetDevices = await prisma.fl_Device.findMany({
      where: { id: { in: deviceIds } },
      select: { clientName: true },
    })
    const tenantName = targetDevices[0]?.clientName ?? "unknown"
    const gatedPayload = {
      patchId: id,
      deviceIds: [...deviceIds].sort(),
      dryRun: body.dryRun !== false,
      rebootPolicy: body.rebootPolicy ?? null,
    }
    const { hex: payloadHash } = hashPayload(gatedPayload)
    const gate = await shouldRequireApproval("bulk.dispatch", tenantName, {
      deviceCount: deviceIds.length,
    })
    if (gate.required) {
      if (!body.approvalId) {
        const approval = await requireApproval({
          action: "bulk.dispatch",
          tenantName,
          payload: gatedPayload,
          scope: `patch ${id} → ${deviceIds.length} devices`,
          requestedBy: session.email,
        })
        addAuditDetail(req, { approvalRequested: approval.approvalId, reason: gate.reason })
        return NextResponse.json(
          { status: "approval-required", approvalId: approval.approvalId, reason: gate.reason, deviceCount: deviceIds.length },
          { status: 202 },
        )
      }
      const consumed = await consumeApproval({
        approvalId: body.approvalId,
        action: "bulk.dispatch",
        payloadHash,
      })
      if (!consumed.ok) {
        return NextResponse.json({ error: consumed.reason }, { status: consumed.status })
      }
      addAuditDetail(req, { approvalConsumed: body.approvalId })
    }

    try {
      const result = await dispatchPatchDeploy({
        patchId: id,
        deviceIds,
        dryRun: body.dryRun !== false, // protocol default = true
        rebootPolicy: body.rebootPolicy,
        initiatedBy: session.email,
      })
      return NextResponse.json(result, { status: 201 })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      )
    }
  },
)
