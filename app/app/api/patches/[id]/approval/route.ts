import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { isPatchApprovalState, setPatchApproval } from "@/lib/patch-catalog"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    state?: string
    notes?: string
  }
  if (!body.state || !isPatchApprovalState(body.state)) {
    return NextResponse.json(
      { error: "state must be approved | declined | deferred | needs-approval" },
      { status: 400 },
    )
  }
  try {
    const patch = await setPatchApproval(id, body.state, session.email, body.notes)
    return NextResponse.json(patch)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
