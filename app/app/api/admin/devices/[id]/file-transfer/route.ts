import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"
import { dispatchToAgent } from "@/lib/agent-dispatch"

// Phase 9 WS-D §6.2 — create a file-transfer (push or pull).
// Body: { direction: "push"|"pull", remotePath: string,
//         justification?: string,
//         pushSourceUrl?: string  // when direction=push, signed URL
//                                  // the agent will fetch from
//       }
// Agent handlers: file.push / file.pull; both report back via WSS.

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "file.transfer.create" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      direction?: "push" | "pull"
      remotePath?: string
      justification?: string
      pushSourceUrl?: string
    }
    if (!body.direction || !["push", "pull"].includes(body.direction)) {
      return NextResponse.json({ error: "direction must be push|pull" }, { status: 400 })
    }
    if (!body.remotePath?.trim()) {
      return NextResponse.json({ error: "remotePath required" }, { status: 400 })
    }

    const device = await prisma.fl_Device.findUnique({
      where: { id },
      select: { id: true, clientName: true, agentId: true, isOnline: true },
    })
    if (!device) return NextResponse.json({ error: "device not found" }, { status: 404 })
    if (!device.agentId) return NextResponse.json({ error: "device has no enrolled agent" }, { status: 400 })

    const tenant = await prisma.fl_Tenant.findUnique({
      where: { name: device.clientName },
      select: {
        fileTransferEnabled: true,
        fileTransferRequiresJustification: true,
        fileTransferMaxSizeMb: true,
      },
    })
    if (!tenant?.fileTransferEnabled) {
      return NextResponse.json({ error: "file transfer not enabled for this tenant" }, { status: 403 })
    }
    if (tenant.fileTransferRequiresJustification && !body.justification?.trim()) {
      return NextResponse.json({ error: "justification required by tenant policy" }, { status: 400 })
    }

    const transfer = await prisma.fl_FileTransfer.create({
      data: {
        deviceId: device.id,
        direction: body.direction,
        remotePath: body.remotePath.trim(),
        state: "queued",
        requestedBy: session.email,
        justification: body.justification?.trim() || null,
      },
    })

    const method = body.direction === "push" ? "file.push" : "file.pull"
    const dispatchParams: Record<string, unknown> = {
      transferId: transfer.id,
      remotePath: body.remotePath.trim(),
      maxSizeMb: tenant.fileTransferMaxSizeMb,
    }
    if (body.direction === "push" && body.pushSourceUrl) {
      dispatchParams.signedUrl = body.pushSourceUrl
    }

    const dispatch = await dispatchToAgent({
      agentId: device.agentId,
      method,
      params: dispatchParams,
      id: transfer.id,
    })
    if (!dispatch.ok) {
      await prisma.fl_FileTransfer.update({
        where: { id: transfer.id },
        data: { state: "failed", errorMsg: `dispatch failed: ${dispatch.error}`, completedAt: new Date() },
      })
      return NextResponse.json({ ok: false, transferId: transfer.id, error: dispatch.error }, { status: 502 })
    }
    return NextResponse.json({ ok: true, transferId: transfer.id }, { status: 201 })
  },
)
