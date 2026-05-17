import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { writeAudit } from "@/lib/audit"
import { validateMonitorPayload } from "@/lib/monitor-validate"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 3 — admin POST to create a monitor.
// Prisma client doesn't yet know Fl_Monitor (raw DDL applied in
// step 1) — writes go through $executeRaw with a generated cuid.

export async function POST(req: NextRequest) {
  const ctx = await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const v = validateMonitorPayload(body)
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

  // Sanity-check the tenant. Null is allowed (means "all tenants");
  // a named tenant must already exist somewhere — either Fl_Tenant
  // or as the clientName on at least one active Fl_Device. Matches
  // the same look-up the alert-routing form uses.
  if (v.tenantName) {
    const [tenantRow, devRow] = await Promise.all([
      prisma.fl_Tenant.findUnique({ where: { name: v.tenantName }, select: { name: true } }),
      prisma.fl_Device.findFirst({
        where: { isActive: true, clientName: v.tenantName },
        select: { id: true },
      }),
    ])
    if (!tenantRow && !devRow) {
      return NextResponse.json(
        { error: `Tenant "${v.tenantName}" not found (no Fl_Tenant row or active device with that clientName)` },
        { status: 400 },
      )
    }
  }

  const id = randomUUID()
  const now = new Date()
  await prisma.$executeRaw`
    INSERT INTO fleethub.fl_monitors
      (id, name, "tenantName", metric, "predicateJson", severity, "emitKind",
       "cooldownMin", "isActive", "createdBy", "fireCount", "createdAt", "updatedAt")
    VALUES
      (${id}, ${v.name}, ${v.tenantName}, ${v.metric}, ${JSON.stringify(v.predicate)},
       ${v.severity}, ${v.emitKind}, ${v.cooldownMin}, ${v.isActive}, ${ctx.email}, 0, ${now}, ${now})
  `

  await writeAudit({
    actorEmail: ctx.email,
    clientName: v.tenantName ?? null,
    action: "monitor.create",
    outcome: "ok",
    detail: {
      monitorId: id,
      name: v.name,
      metric: v.metric,
      severity: v.severity,
      emitKind: v.emitKind,
      predicate: v.predicate,
    },
  }).catch(() => undefined)

  return NextResponse.json({ id }, { status: 201 })
}
