import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { dispatchPatchDeploy } from "@/lib/patch-deploy"

// POST /api/patches/[id]/deploy
// Body: { deviceIds: string[], dryRun: boolean, rebootPolicy?: string }
//
// Operator clicks Deploy on /patches/[id]; the patch must already be in
// approvalState="approved" (gated server-side in dispatchPatchDeploy).
// Per AGENT-PROTOCOL §14, dryRun defaults to true — UI must explicitly
// set false and the operator must opt in.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    deviceIds?: string[]
    dryRun?: boolean
    rebootPolicy?: string
  }
  if (!Array.isArray(body.deviceIds) || body.deviceIds.length === 0) {
    return NextResponse.json(
      { error: "deviceIds[] required" },
      { status: 400 },
    )
  }
  try {
    const result = await dispatchPatchDeploy({
      patchId: id,
      deviceIds: body.deviceIds,
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
}
