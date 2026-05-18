import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { validateRunbookPayload } from "@/lib/runbook-validate"
import { withAudit } from "@/lib/with-audit"

export const dynamic = "force-dynamic"

export const PATCH = withAudit(
  { action: "runbook.update" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    const existing = await prisma.fl_Runbook.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "runbook not found" }, { status: 404 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const v = validateRunbookPayload(body)
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

    const script = await prisma.fl_Script.findUnique({
      where: { id: v.scriptId },
      select: { isActive: true },
    })
    if (!script) return NextResponse.json({ error: "script not found" }, { status: 400 })

    await prisma.fl_Runbook.update({
      where: { id },
      data: {
        name: v.name,
        description: v.description,
        matchJson: JSON.stringify(v.match),
        scriptId: v.scriptId,
        graceMin: v.graceMin,
        cooldownMin: v.cooldownMin,
        dryRunFirst: v.dryRunFirst,
        dryRunPredicateJson: v.dryRunPredicateJson,
        maxFiresPerHour: v.maxFiresPerHour,
        maxConsecutiveFailures: v.maxConsecutiveFailures,
        isActive: v.isActive,
      },
    })
    return NextResponse.json({ ok: true })
  },
)

export const DELETE = withAudit(
  { action: "runbook.delete" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    const existing = await prisma.fl_Runbook.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "runbook not found" }, { status: 404 })
    // Fl_RunbookFire cascades via the schema's onDelete: Cascade.
    await prisma.fl_Runbook.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  },
)
