import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { dispatchToAgent } from "@/lib/agent-dispatch"
import {
  shouldRequireApproval,
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

// Phase 9 WS-D §6.1 — open an interactive shell session.
//
// Returns { sessionId } that the WSS gateway uses as the stream
// channel handle. The agent side handles `shell.open` by spawning
// powershell.exe / bash and piping stdio. Per-tenant gate via
// Fl_Tenant.shellSessionsEnabled.

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "shell.open" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      justification?: string
      approvalId?: string
    }

    const device = await prisma.fl_Device.findUnique({
      where: { id },
      select: {
        id: true,
        clientName: true,
        agentId: true,
        isOnline: true,
        role: true,
      },
    })
    if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 })
    if (!device.agentId) return NextResponse.json({ error: "device has no enrolled agent" }, { status: 400 })
    if (!device.isOnline) return NextResponse.json({ error: "device is offline" }, { status: 400 })

    const tenant = await prisma.fl_Tenant.findUnique({
      where: { name: device.clientName },
      select: { shellSessionsEnabled: true, shellRequiresJustification: true, shellMaxDurationMin: true },
    })
    if (!tenant?.shellSessionsEnabled) {
      return NextResponse.json({ error: "shell sessions not enabled for this tenant" }, { status: 403 })
    }
    if (tenant.shellRequiresJustification && !body.justification?.trim()) {
      return NextResponse.json({ error: "justification required by tenant policy" }, { status: 400 })
    }

    // Phase 11 WS-B.3 — peer-approval gate when the device's role
    // matches the tenant's shellApprovalTags allowlist. role is
    // free-form ("DC", "workstation", "finance", "prod", …); a
    // single-role match suffices.
    const gatedPayload = {
      deviceId: device.id,
      justification: body.justification?.trim() ?? null,
    }
    const { hex: payloadHash } = hashPayload(gatedPayload)
    const gate = await shouldRequireApproval("shell.open", device.clientName, {
      deviceTags: device.role ? [device.role] : [],
    })
    if (gate.required) {
      if (!body.approvalId) {
        const result = await requireApproval({
          action: "shell.open",
          tenantName: device.clientName,
          payload: gatedPayload,
          scope: `${device.id} · role=${device.role ?? "<none>"}`,
          requestedBy: session.email,
        })
        addAuditDetail(req, { approvalRequested: result.approvalId, reason: gate.reason })
        return NextResponse.json(
          {
            status: "approval-required",
            approvalId: result.approvalId,
            reason: gate.reason,
          },
          { status: 202 },
        )
      }
      const consumed = await consumeApproval({
        approvalId: body.approvalId,
        action: "shell.open",
        payloadHash,
      })
      if (!consumed.ok) {
        return NextResponse.json({ error: consumed.reason }, { status: consumed.status })
      }
      addAuditDetail(req, { approvalConsumed: body.approvalId })
    }

    const created = await prisma.fl_ShellSession.create({
      data: {
        deviceId: device.id,
        operatorEmail: session.email,
        justification: body.justification?.trim() || null,
        state: "open",
      },
    })

    const dispatch = await dispatchToAgent({
      agentId: device.agentId,
      method: "shell.open",
      params: {
        sessionId: created.id,
        maxDurationMin: tenant.shellMaxDurationMin,
      },
      id: created.id,
    })

    if (!dispatch.ok) {
      await prisma.fl_ShellSession.update({
        where: { id: created.id },
        data: {
          state: "agent-disconnected",
          closedAt: new Date(),
          exitReason: `dispatch failed: ${dispatch.error}`,
        },
      })
      return NextResponse.json({ ok: false, sessionId: created.id, error: dispatch.error }, { status: 502 })
    }
    return NextResponse.json({ ok: true, sessionId: created.id, maxDurationMin: tenant.shellMaxDurationMin }, { status: 201 })
  },
)
