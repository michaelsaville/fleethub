import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { updateRing, type RingStage } from "@/lib/rings"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    stages?: RingStage[]
    isDefault?: boolean
  }
  try {
    const ring = await updateRing(id, session.email, body)
    return NextResponse.json(ring)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
