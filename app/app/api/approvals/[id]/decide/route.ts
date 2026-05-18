import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { approveAction, denyAction } from "@/lib/approval-gate"

// Phase 11 WS-B.2 — approver decides. ADMIN-only in v1. Body:
// { decision: "approve" } OR { decision: "deny", reason: "..." }.

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    decision?: "approve" | "deny"
    reason?: string
  }
  if (body.decision === "approve") {
    const result = await approveAction({
      approvalId: id,
      approverEmail: session.email,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: result.status })
    }
    return NextResponse.json({ ok: true })
  }
  if (body.decision === "deny") {
    if (!body.reason?.trim()) {
      return NextResponse.json({ error: "reason required" }, { status: 400 })
    }
    const result = await denyAction({
      approvalId: id,
      approverEmail: session.email,
      reason: body.reason.trim(),
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: result.status })
    }
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json(
    { error: "decision must be 'approve' or 'deny'" },
    { status: 400 },
  )
}
