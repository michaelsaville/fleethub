import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { bulkSetMaintenance } from "@/lib/maintenance"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { prisma } from "@/lib/prisma"
import {
  shouldRequireApproval,
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

// POST /api/devices/maintenance/bulk
// Body: { deviceIds: string[], on: boolean, until?: ISO, reason?: string,
//         approvalId?: string }
//
// Phase 11 WS-B.3 — gated when deviceIds count exceeds the tenant's
// bulkApprovalThreshold. Cross-tenant bulk is refused (operator must
// batch per tenant). Without approvalId in body, route creates
// Fl_ActionApproval(pending) and returns 202; with approvalId, route
// consumes and proceeds.
export const POST = withAudit({ action: "device.maintenance.bulk" }, async (req: NextRequest) => {
  const session = await requireSession()
  const body = (await req.json().catch(() => ({}))) as {
    deviceIds?: string[]
    on?: boolean
    until?: string | null
    reason?: string | null
    approvalId?: string
  }
  if (!Array.isArray(body.deviceIds) || body.deviceIds.length === 0) {
    return NextResponse.json({ error: "deviceIds required" }, { status: 400 })
  }
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "on (boolean) required" }, { status: 400 })
  }

  // Resolve tenant set. Cross-tenant bulk refused.
  const devices = await prisma.fl_Device.findMany({
    where: { id: { in: body.deviceIds } },
    select: { id: true, clientName: true },
  })
  const tenants = new Set(devices.map((d) => d.clientName))
  if (tenants.size === 0) {
    return NextResponse.json({ error: "no devices match deviceIds" }, { status: 404 })
  }
  if (tenants.size > 1) {
    return NextResponse.json(
      {
        error: `bulk maintenance must target a single tenant (got ${tenants.size}); split per tenant`,
      },
      { status: 400 },
    )
  }
  const tenantName = [...tenants][0]

  // Payload that gets hashed for the anti-swap guard.
  const gatedPayload = {
    deviceIds: [...body.deviceIds].sort(),
    on: body.on,
    until: body.until ?? null,
    reason: body.reason ?? null,
  }
  const { hex: payloadHash } = hashPayload(gatedPayload)

  const gate = await shouldRequireApproval("bulk.dispatch", tenantName, {
    deviceCount: body.deviceIds.length,
  })
  if (gate.required) {
    if (!body.approvalId) {
      // First call: create approval, return 202.
      const result = await requireApproval({
        action: "bulk.dispatch",
        tenantName,
        payload: gatedPayload,
        scope: `${body.deviceIds.length} devices · ${gate.reason}`,
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
    // Second call: consume the approval.
    const consumed = await consumeApproval({
      approvalId: body.approvalId,
      action: "bulk.dispatch",
      payloadHash,
    })
    if (!consumed.ok) {
      return NextResponse.json({ error: consumed.reason }, { status: consumed.status })
    }
    addAuditDetail(req, { approvalConsumed: body.approvalId })
  }

  try {
    const results = await bulkSetMaintenance(body.deviceIds, {
      on: body.on,
      until: body.until ? new Date(body.until) : null,
      reason: body.reason ?? null,
      setBy: session.email,
    })
    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
