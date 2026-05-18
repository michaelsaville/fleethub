import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { dispatchPatchDeploy } from "@/lib/patch-deploy"
import { withAudit } from "@/lib/with-audit"
import { resolveGroupTargets } from "@/lib/targeting"

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
    const session = await requireSession()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      deviceIds?: string[]
      groupId?: string
      dryRun?: boolean
      rebootPolicy?: string
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
