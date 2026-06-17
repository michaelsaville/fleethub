import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRoleResponse } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { dispatchToAgent } from "@/lib/agent-dispatch"
import {
  shouldRequireApproval,
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

// WS-C — POST /api/admin/devices/[id]/power
// Body: { action: "reboot" | "shutdown" | "logoff", delaySec?, message?, force?, approvalId? }
//
// Dispatches a power.* verb to the device's agent via the gateway.
// SEC-2: TECH+ only. shutdown/logoff require 4-eyes (a remote host
// won't power itself back on); reboot is TECH + confirm.

const ACTIONS = new Set(["reboot", "shutdown", "logoff"])

export const POST = withAudit(
  { action: "device.power" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const gateAuth = await requireRoleResponse("TECH")
    if ("response" in gateAuth) return gateAuth.response
    const session = gateAuth.ctx
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      delaySec?: number
      message?: string
      force?: boolean
      approvalId?: string
    }

    const action = body.action ?? ""
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: "action must be reboot, shutdown, or logoff" }, { status: 400 })
    }

    const device = await prisma.fl_Device.findUnique({
      where: { id },
      select: { id: true, clientName: true, hostname: true, agentId: true, isOnline: true },
    })
    if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 })
    if (!device.agentId) return NextResponse.json({ error: "device has no enrolled agent" }, { status: 400 })
    if (!device.isOnline) return NextResponse.json({ error: "device is offline" }, { status: 400 })

    const delaySec = Math.max(0, Math.min(3600, body.delaySec ?? 0))
    const gatedPayload = {
      deviceId: device.id,
      action,
      delaySec,
      message: body.message ?? null,
      force: body.force ?? false,
    }
    const { hex: payloadHash } = hashPayload(gatedPayload)

    const gate = await shouldRequireApproval("device.power", device.clientName, {
      powerAction: action,
    })
    if (gate.required) {
      if (!body.approvalId) {
        const approval = await requireApproval({
          action: "device.power",
          tenantName: device.clientName,
          payload: gatedPayload,
          scope: `${action} ${device.hostname}`,
          requestedBy: session.email,
        })
        addAuditDetail(req, { approvalRequested: approval.approvalId, reason: gate.reason })
        return NextResponse.json(
          { status: "approval-required", approvalId: approval.approvalId, reason: gate.reason },
          { status: 202 },
        )
      }
      const consumed = await consumeApproval({
        approvalId: body.approvalId,
        action: "device.power",
        payloadHash,
      })
      if (!consumed.ok) {
        return NextResponse.json({ error: consumed.reason }, { status: consumed.status })
      }
      addAuditDetail(req, { approvalConsumed: body.approvalId })
    }

    addAuditDetail(req, { action, hostname: device.hostname, delaySec })

    const dispatch = await dispatchToAgent({
      agentId: device.agentId,
      method: `power.${action}`,
      params: { commandId: `${device.id}-${action}`, delaySec, message: body.message ?? "", force: body.force ?? false },
      id: `${device.id}-power-${action}`,
    })

    if (!dispatch.ok) {
      return NextResponse.json({ ok: false, error: dispatch.error }, { status: 502 })
    }
    return NextResponse.json({ ok: true, action, hostname: device.hostname, delaySec }, { status: 200 })
  },
)
