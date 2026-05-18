import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { createDeployment } from "@/lib/deployments"
import { withAudit } from "@/lib/with-audit"
import { resolveGroupTargets } from "@/lib/targeting"

// POST /api/deployments
// Body: {
//   tenantName, packageId, packageVersionId, ringId, action,
//   dryRun?, rebootPolicyOverride?, scheduledFor?,
//   targetDeviceIds[]?,    // OR
//   targetGroupId?,        // Phase 10 WS-A §3.5 — Fl_DeviceGroup
// }
// One of targetDeviceIds / targetGroupId is required.
export const POST = withAudit({ action: "deployment.create" }, async (req: NextRequest) => {
  const session = await requireSession()
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
