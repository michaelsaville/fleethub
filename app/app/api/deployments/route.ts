import { NextRequest, NextResponse } from "next/server"
import { requireRoleResponse } from "@/lib/authz"
import { createDeployment } from "@/lib/deployments"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { resolveGroupTargets } from "@/lib/targeting"
import {
  shouldRequireApproval,
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

// POST /api/deployments
// Body: {
//   tenantName, packageId, packageVersionId, ringId, action,
//   dryRun?, rebootPolicyOverride?, scheduledFor?,
//   targetDeviceIds[]?,    // OR
//   targetGroupId?,        // Phase 10 WS-A §3.5 — Fl_DeviceGroup
// }
// One of targetDeviceIds / targetGroupId is required.
export const POST = withAudit({ action: "deployment.create" }, async (req: NextRequest) => {
  // SEC-2 — creating a deployment executes packages on endpoints; TECH+ only.
  const gateAuth = await requireRoleResponse("TECH")
  if ("response" in gateAuth) return gateAuth.response
  const session = gateAuth.ctx
  const body = (await req.json().catch(() => ({}))) as {
    tenantName?: string
    packageId?: string
    packageVersionId?: string
    ringId?: string
    action?: "install" | "uninstall" | "update"
    dryRun?: boolean
    rebootPolicyOverride?: string | null
    scheduledFor?: string | null
    targetDeviceIds?: string[]
    targetGroupId?: string
    approvalId?: string
  }
  // Phase 10 WS-A §3.5 — resolve groupId into deviceIds. Group +
  // explicit list both provided: explicit list wins (operator
  // override semantic). Empty resolution → 400 with hint to fix
  // the group membership.
  let deviceIds = body.targetDeviceIds ?? []
  if (deviceIds.length === 0 && body.targetGroupId) {
    const resolved = await resolveGroupTargets(body.targetGroupId)
    deviceIds = resolved.map((d) => d.id)
    if (deviceIds.length === 0) {
      return NextResponse.json(
        { error: `group ${body.targetGroupId} resolves to 0 active devices` },
        { status: 400 },
      )
    }
  }
  if (
    !body.tenantName ||
    !body.packageId ||
    !body.packageVersionId ||
    !body.ringId ||
    !body.action ||
    deviceIds.length === 0
  ) {
    return NextResponse.json(
      { error: "tenantName, packageId, packageVersionId, ringId, action, and (targetDeviceIds OR targetGroupId) required" },
      { status: 400 },
    )
  }

  // Phase 11 WS-B.3 — bulk.dispatch gate. Triggered when resolved
  // deviceIds count exceeds tenant.bulkApprovalThreshold, OR when
  // action='uninstall' on any count (architect: uninstall is
  // destructive regardless of count).
  const sortedIds = [...deviceIds].sort()
  const gatedPayload = {
    tenantName: body.tenantName,
    packageId: body.packageId,
    packageVersionId: body.packageVersionId,
    ringId: body.ringId,
    action: body.action,
    deviceIds: sortedIds,
    dryRun: body.dryRun ?? false,
  }
  const { hex: payloadHash } = hashPayload(gatedPayload)
  const uninstallGate = body.action === "uninstall"
  const sizeGate = await shouldRequireApproval("bulk.dispatch", body.tenantName, {
    deviceCount: deviceIds.length,
  })
  const required = uninstallGate || sizeGate.required
  if (required) {
    if (!body.approvalId) {
      const reason = uninstallGate
        ? "uninstall action requires peer review (destructive)"
        : sizeGate.reason
      const result = await requireApproval({
        action: "bulk.dispatch",
        tenantName: body.tenantName,
        payload: gatedPayload,
        scope: `${body.action} · ${deviceIds.length} devices`,
        requestedBy: session.email,
      })
      addAuditDetail(req, { approvalRequested: result.approvalId, reason })
      return NextResponse.json(
        { status: "approval-required", approvalId: result.approvalId, reason },
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
    const deployment = await createDeployment({
      tenantName: body.tenantName,
      packageId: body.packageId,
      packageVersionId: body.packageVersionId,
      ringId: body.ringId,
      action: body.action,
      dryRun: body.dryRun,
      rebootPolicyOverride: body.rebootPolicyOverride ?? null,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      targetDeviceIds: deviceIds,
      requestedBy: session.email,
    })
    return NextResponse.json(deployment, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
})
