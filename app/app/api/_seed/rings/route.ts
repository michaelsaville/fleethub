import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { createRing, STANDARD_4_STAGE, HEALTHCARE_CONSERVATIVE } from "@/lib/rings"

// One-shot seeder for the default ring set across all known tenants.
// Skips tenants that already have a default ring. ADMIN-only.
export async function POST(_req: NextRequest) {
  const session = await requireAdmin()
  const tenantNames = await prisma.fl_Device.findMany({
    select: { clientName: true },
    distinct: ["clientName"],
  })

  const created: string[] = []
  for (const t of tenantNames) {
    const existing = await prisma.fl_DeployRing.findFirst({
      where: { tenantName: t.clientName, isDefault: true, archivedAt: null },
    })
    if (existing) continue
    await createRing({
      tenantName: t.clientName,
      name: "Standard 4-stage",
      stages: STANDARD_4_STAGE,
      isDefault: true,
      createdBy: session.email,
    })
    await createRing({
      tenantName: t.clientName,
      name: "Healthcare conservative",
      stages: HEALTHCARE_CONSERVATIVE,
      createdBy: session.email,
    })
    created.push(t.clientName)
  }
  return NextResponse.json({ ok: true, tenantsSeeded: created })
}
