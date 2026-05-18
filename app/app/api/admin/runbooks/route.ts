import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { validateRunbookPayload } from "@/lib/runbook-validate"
import { withAudit } from "@/lib/with-audit"

export const dynamic = "force-dynamic"

export const POST = withAudit({ action: "runbook.create" }, async (req: NextRequest) => {
  const ctx = await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const v = validateRunbookPayload(body)
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

  // Validate the script actually exists + is active.
  const script = await prisma.fl_Script.findUnique({
    where: { id: v.scriptId },
    select: { id: true, isActive: true },
  })
  if (!script) return NextResponse.json({ error: "script not found" }, { status: 400 })
  if (!script.isActive) return NextResponse.json({ error: "script is inactive — re-activate it before binding a runbook" }, { status: 400 })

  const created = await prisma.fl_Runbook.create({
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
      createdBy: ctx.email,
    },
    select: { id: true },
  })
  return NextResponse.json({ id: created.id }, { status: 201 })
})
