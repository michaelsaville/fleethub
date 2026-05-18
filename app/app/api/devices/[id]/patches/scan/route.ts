import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { dispatchToAgent } from "@/lib/agent-dispatch"
import { writeAudit } from "@/lib/audit"

// POST /api/devices/[id]/patches/scan
// Dispatches a one-shot patches.scan to the device's agent. The agent
// posts results back through the existing patches.complete ingest path
// — this endpoint is just the trigger, not the receiver.
//
// Returns 200 on dispatch ok, 503 with `reason: not-enrolled | offline
// | gateway-error` on failure so the PatchesTab can render a clean
// status message rather than a generic 500.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  const { id } = await params
  const device = await prisma.fl_Device.findUnique({
    where: { id },
    select: { id: true, agentId: true, hostname: true, clientName: true, isOnline: true },
  })
  if (!device) {
    return NextResponse.json({ error: "device not found" }, { status: 404 })
  }
  if (!device.agentId) {
    return NextResponse.json(
      { ok: false, reason: "not-enrolled", message: "Device has no enrolled agent." },
      { status: 503 },
    )
  }

  const cmdId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const result = await dispatchToAgent({
    agentId: device.agentId,
    method: "patches.scan",
    id: cmdId,
    params: { commandId: cmdId, detectionMethods: [], fullRescan: false },
  })

  await writeAudit({
    actorEmail: session.email,
    clientName: device.clientName,
    deviceId: device.id,
    action: "patches.scan.manual",
    outcome: result.ok ? "ok" : "error",
    detail: {
      commandId: cmdId,
      online: device.isOnline,
      error: result.ok ? undefined : result.error,
    },
  }).catch(() => {})

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: "gateway-error",
        message: result.error,
        commandId: cmdId,
      },
      { status: 503 },
    )
  }
  return NextResponse.json({ ok: true, commandId: cmdId })
}
