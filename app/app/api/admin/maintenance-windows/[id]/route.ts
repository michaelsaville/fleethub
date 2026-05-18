import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"

// Phase 12 WS-B — Fl_MaintenanceWindow PATCH (toggle isActive) +
// DELETE (soft, sets isActive=false to preserve audit references).

export const dynamic = "force-dynamic"

export const PATCH = withAudit(
  { action: "maintenance-window.update" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      cron?: string
      durationMin?: number
      suppressAlertKindsJson?: string | null
      scopeJson?: string | null
      isActive?: boolean
    }
    const data: Record<string, unknown> = {}
    if (typeof body.name === "string") data.name = body.name.trim()
    if (typeof body.cron === "string") data.cron = body.cron.trim()
    if (typeof body.durationMin === "number") data.durationMin = body.durationMin
    if (body.suppressAlertKindsJson !== undefined) data.suppressAlertKindsJson = body.suppressAlertKindsJson
    if (body.scopeJson !== undefined) data.scopeJson = body.scopeJson
    if (typeof body.isActive === "boolean") data.isActive = body.isActive
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 })
    }
    await prisma.fl_MaintenanceWindow.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  },
)

export const DELETE = withAudit(
  { action: "maintenance-window.delete" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    await prisma.fl_MaintenanceWindow.update({
      where: { id },
      data: { isActive: false },
    })
    return NextResponse.json({ ok: true })
  },
)
