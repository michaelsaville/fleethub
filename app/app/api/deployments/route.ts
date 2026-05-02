import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { createDeployment } from "@/lib/deployments"

// POST /api/deployments
// Body: {
//   tenantName, packageId, packageVersionId, ringId, action,
//   dryRun?, rebootPolicyOverride?, scheduledFor?, targetDeviceIds[]
// }
export async function POST(req: NextRequest) {
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
  }
  if (
    !body.tenantName ||
    !body.packageId ||
    !body.packageVersionId ||
    !body.ringId ||
    !body.action ||
    !Array.isArray(body.targetDeviceIds) ||
    body.targetDeviceIds.length === 0
  ) {
    return NextResponse.json(
      { error: "tenantName, packageId, packageVersionId, ringId, action, targetDeviceIds required" },
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
      targetDeviceIds: body.targetDeviceIds,
      requestedBy: session.email,
    })
    return NextResponse.json(deployment, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
