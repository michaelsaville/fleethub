import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { validateSchedulePayload } from "@/lib/oncall-validate"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const v = validateSchedulePayload(body)
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

  const created = await prisma.fl_OncallSchedule.create({
    data: {
      name: v.name,
      rotationJson: JSON.stringify(v.rotation),
      overridesJson: v.overrides.length > 0 ? JSON.stringify(v.overrides) : null,
      isActive: v.isActive,
    },
    select: { id: true },
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
}
