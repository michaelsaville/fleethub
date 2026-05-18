import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { abortDeployment } from "@/lib/deployments"
import { withAudit } from "@/lib/with-audit"

export const POST = withAudit(
  { action: "deployment.abort" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin()
    const { id } = await params
    try {
      return NextResponse.json(await abortDeployment(id, session.email))
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
  },
)
