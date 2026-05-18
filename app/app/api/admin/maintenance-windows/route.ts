import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { CronExpressionParser } from "cron-parser"

// Phase 12 WS-B — Fl_MaintenanceWindow CRUD.

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  await requireAdmin()
  const tenant = req.nextUrl.searchParams.get("tenantName")?.trim() || undefined
  const rows = await prisma.fl_MaintenanceWindow.findMany({
    where: { isActive: true, ...(tenant ? { tenantName: tenant } : {}) },
    orderBy: [{ tenantName: "asc" }, { name: "asc" }],
  })
  return NextResponse.json({ windows: rows })
}

export const POST = withAudit(
  { action: "maintenance-window.create" },
  async (req: NextRequest) => {
    const session = await requireAdmin()
    const body = (await req.json().catch(() => ({}))) as {
      tenantName?: string
      name?: string
      cron?: string
      durationMin?: number
      suppressAlertKindsJson?: string | null
      scopeJson?: string | null
    }
    if (!body.tenantName?.trim() || !body.name?.trim() || !body.cron?.trim() || !body.durationMin) {
      return NextResponse.json(
        { error: "tenantName, name, cron, durationMin required" },
        { status: 400 },
      )
    }
    if (body.durationMin < 1 || body.durationMin > 1440) {
      return NextResponse.json({ error: "durationMin must be 1-1440" }, { status: 400 })
    }
    try {
      CronExpressionParser.parse(body.cron)
    } catch (e) {
      return NextResponse.json(
        { error: `invalid cron: ${e instanceof Error ? e.message : "parse error"}` },
        { status: 400 },
      )
    }
    const created = await prisma.fl_MaintenanceWindow.create({
      data: {
        tenantName: body.tenantName.trim(),
        name: body.name.trim(),
        cron: body.cron.trim(),
        durationMin: body.durationMin,
        suppressAlertKindsJson: body.suppressAlertKindsJson?.trim() || null,
        scopeJson: body.scopeJson?.trim() || null,
        createdBy: session.email,
      },
    })
    addAuditDetail(req, { windowId: created.id, tenant: created.tenantName })
    return NextResponse.json({ id: created.id }, { status: 201 })
  },
)
