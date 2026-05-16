import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { validateRoutePayload } from "@/lib/alert-route-validate"

// Phase 7 Workstream A step 3 — Fl_AlertRoute CRUD (collection).
// POST creates; GET is unused here (the list page reads via Prisma
// directly). Per-id update + delete live in [id]/route.ts.

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const v = validateRoutePayload(body)
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

  const created = await prisma.fl_AlertRoute.create({
    data: {
      tenantName: v.tenantName,
      matchJson: JSON.stringify(v.match),
      channelsJson: JSON.stringify(v.channels),
      escalationJson: null,
      dedupWindowMin: v.dedupWindowMin,
      isActive: v.isActive,
      priority: v.priority,
    },
    select: { id: true },
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
}
