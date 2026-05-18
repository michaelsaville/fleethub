import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { pauseDeployment } from "@/lib/deployments"
import { withAudit } from "@/lib/with-audit"

export const POST = withAudit(
  { action: "deployment.pause" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { reason?: string }
    try {
      const dep = await pauseDeployment(id, session.email, body.reason ?? "operator-paused")
      return NextResponse.json(dep)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
  },
)
