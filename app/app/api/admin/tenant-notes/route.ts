import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"

// Phase 10 WS-C §5.6 — Fl_TenantNote CRUD. Same shape as
// /api/admin/device-notes; keyed by tenantName.

export const dynamic = "force-dynamic"

export const POST = withAudit({ action: "tenantNote.create" }, async (req: NextRequest) => {
  const session = await requireSession()
  const body = (await req.json().catch(() => ({}))) as {
    tenantName?: string
    body?: string
    isPinned?: boolean
  }
  if (!body.tenantName?.trim() || !body.body?.trim()) {
    return NextResponse.json({ error: "tenantName + body required" }, { status: 400 })
  }
  if (body.body.length > 16_000) {
    return NextResponse.json({ error: "body must be ≤ 16,000 chars" }, { status: 400 })
  }
  const created = await prisma.fl_TenantNote.create({
    data: {
      tenantName: body.tenantName,
      body: body.body.trim(),
      isPinned: body.isPinned ?? false,
      createdBy: session.email,
    },
    select: { id: true },
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
})
