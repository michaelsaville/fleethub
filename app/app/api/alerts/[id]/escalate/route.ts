import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { forceEscalate } from "@/lib/alert-dispatch"
import { writeAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"

// Phase 7 Workstream A step 9 — force-fire the next escalation
// step on demand. Skips the escalateAt wait. ADMIN-only — bumping
// a chain manually has real notification cost and operators
// should be deliberate.

export const dynamic = "force-dynamic"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin()
  const { id } = await params
  const alert = await prisma.fl_Alert.findUnique({
    where: { id },
    select: { clientName: true, deviceId: true, kind: true, severity: true },
  })
  const result = await forceEscalate(id)
  await writeAudit({
    actorEmail: ctx.email,
    clientName: alert?.clientName ?? null,
    deviceId: alert?.deviceId ?? null,
    action: "alert.escalate.manual",
    outcome: result.status === "escalated" ? "ok" : "error",
    detail: { alertId: id, ...result },
  })
  return NextResponse.json(result)
}
