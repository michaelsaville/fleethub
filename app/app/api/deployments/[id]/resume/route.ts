import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { resumeDeployment } from "@/lib/deployments"
import { withAudit } from "@/lib/with-audit"

export const POST = withAudit(
  { action: "deployment.resume" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession()
    const { id } = await params
    try {
      return NextResponse.json(await resumeDeployment(id, session.email))
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
  },
)
