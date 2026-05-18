import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"
import { dispatchToAgent } from "@/lib/agent-dispatch"

// Phase 9 WS-C §5.4 — operator-initiated backup trigger. Per-tenant
// gate via Fl_Tenant.backupTriggerEnabled + optional justification.

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "backup.trigger" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { justification?: string }

    const device = await prisma.fl_Device.findUnique({
      where: { id },
      select: { id: true, clientName: true, backupProduct: true, agentId: true },
    })
    if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 })
    if (!device.agentId) return NextResponse.json({ error: "device has no enrolled agent" }, { status: 400 })
    if (!device.backupProduct || device.backupProduct === "none") {
      return NextResponse.json(
        { error: "no backup product detected on this device — install one + wait for posture refresh" },
        { status: 400 },
      )
    }

    const tenant = await prisma.fl_Tenant.findUnique({
      where: { name: device.clientName },
      select: { backupTriggerEnabled: true, backupTriggerRequiresJustification: true },
    })
    if (!tenant?.backupTriggerEnabled) {
      return NextResponse.json(
        { error: "backup trigger not enabled for this tenant" },
        { status: 403 },
      )
    }
    if (tenant.backupTriggerRequiresJustification && !body.justification?.trim()) {
      return NextResponse.json(
        { error: "justification required by tenant policy" },
        { status: 400 },
      )
    }

    const run = await prisma.fl_BackupRun.create({
      data: {
        deviceId: device.id,
        product: device.backupProduct,
        triggeredBy: session.email,
        justification: body.justification?.trim() || null,
        state: "queued",
      },
    })

    // Fire the agent verb. The agent side adds backup.trigger handler
    // in a follow-up commit; FH side ships the schema + route now so
    // the UI is wired end-to-end and the verb just returns "queued"
    // until the agent picks it up.
    const dispatch = await dispatchToAgent({
      agentId: device.agentId,
      method: "backup.trigger",
      params: { runId: run.id, product: device.backupProduct },
      id: run.id,
    })

    if (!dispatch.ok) {
      // Don't fail the route — the run row is the source of truth.
      // Operator sees state="queued" on the device page until the
      // agent picks it up or the watcher cron marks it failed.
      await prisma.fl_BackupRun.update({
        where: { id: run.id },
        data: { state: "failed", errorMsg: `dispatch failed: ${dispatch.error}`, completedAt: new Date() },
      })
      return NextResponse.json(
        { ok: false, runId: run.id, error: dispatch.error },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true, runId: run.id }, { status: 201 })
  },
)
