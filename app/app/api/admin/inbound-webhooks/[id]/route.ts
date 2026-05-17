import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { writeAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 6 — toggle / delete an inbound webhook.
// Token + tenant + source are immutable after create; if any of
// those are wrong, the operator deletes + re-adds. Keeping the row
// shape immutable simplifies the audit story (every payload was
// matched against the same routing config).

interface ExistingRow {
  id: string
  name: string
  tenantName: string
  source: string
  isActive: boolean
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const rows = await prisma.$queryRaw<ExistingRow[]>`
    SELECT id, name, "tenantName", source, "isActive"
    FROM fleethub.fl_inbound_webhooks WHERE id = ${id}
  `
  const existing = rows[0]
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 })

  if (typeof body.isActive === "boolean" && body.isActive !== existing.isActive) {
    await prisma.$executeRaw`
      UPDATE fleethub.fl_inbound_webhooks
      SET "isActive" = ${body.isActive}, "updatedAt" = NOW()
      WHERE id = ${id}
    `
    await writeAudit({
      actorEmail: ctx.email,
      clientName: existing.tenantName,
      action: body.isActive ? "inbound.webhook.activate" : "inbound.webhook.deactivate",
      outcome: "ok",
      detail: { webhookId: id, name: existing.name, source: existing.source },
    }).catch(() => undefined)
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin()
  const { id } = await params

  const rows = await prisma.$queryRaw<ExistingRow[]>`
    SELECT id, name, "tenantName", source FROM fleethub.fl_inbound_webhooks WHERE id = ${id}
  `
  const existing = rows[0]
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 })

  await prisma.$executeRaw`
    DELETE FROM fleethub.fl_inbound_webhooks WHERE id = ${id}
  `
  await writeAudit({
    actorEmail: ctx.email,
    clientName: existing.tenantName,
    action: "inbound.webhook.delete",
    outcome: "ok",
    detail: { webhookId: id, name: existing.name, source: existing.source },
  }).catch(() => undefined)

  return NextResponse.json({ ok: true })
}
