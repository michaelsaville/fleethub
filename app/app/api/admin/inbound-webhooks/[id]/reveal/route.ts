import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { writeAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 6 — return the token for an inbound
// webhook. ADMIN-only; every reveal is audited so a leak can be
// traced back to who looked at the token, when.

interface RevealRow {
  id: string
  name: string
  tenantName: string
  source: string
  token: string
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin()
  const { id } = await params

  const rows = await prisma.$queryRaw<RevealRow[]>`
    SELECT id, name, "tenantName", source, token
    FROM fleethub.fl_inbound_webhooks
    WHERE id = ${id}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })

  await writeAudit({
    actorEmail: ctx.email,
    clientName: row.tenantName,
    action: "inbound.webhook.token.reveal",
    outcome: "ok",
    detail: { webhookId: id, name: row.name, source: row.source },
  }).catch(() => undefined)

  return NextResponse.json({ token: row.token })
}
