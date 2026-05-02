import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { createRing, type RingStage } from "@/lib/rings"

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as {
    tenantName?: string
    name?: string
    stages?: RingStage[]
    isDefault?: boolean
  }
  if (!body.tenantName || !body.name || !body.stages || body.stages.length === 0) {
    return NextResponse.json(
      { error: "tenantName, name, stages required" },
      { status: 400 },
    )
  }
  try {
    const ring = await createRing({
      tenantName: body.tenantName,
      name: body.name,
      stages: body.stages,
      isDefault: body.isDefault,
      createdBy: session.email,
    })
    return NextResponse.json(ring, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
