import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRoleResponse } from "@/lib/authz"
import { runScript } from "@/lib/script-commands"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { resolveGroupTargets } from "@/lib/targeting"
import {
  shouldRequireApproval,
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

// POST /api/scripts/[id]/run
// Body: {
//   deviceId?: string,    // single-device run, OR
//   groupId?: string,     // Phase 10 WS-A §3.5 — fan-out across group
//   dryRun?, args?, env?
// }
// When groupId is set, the route fans out N runScript calls (one
// per resolved device) and returns the array of run rows. Single
// deviceId returns one row as before.
export const POST = withAudit(
  { action: "script.run" },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    // SEC-2 — code execution is TECH+ only. A VIEWER must not be able to
    // POST a fleet-wide script run just because the UI hides the button.
    const gateAuth = await requireRoleResponse("TECH")
    if ("response" in gateAuth) return gateAuth.response
    const session = gateAuth.ctx
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      deviceId?: string
      groupId?: string
      deviceIds?: string[] // SA-3 — ad-hoc host set from /devices BulkBar
      dryRun?: boolean
      args?: string[]
      env?: Record<string, string>
      approvalId?: string
    }

    // Fan-out path: either a saved group OR an ad-hoc deviceIds[] set
    // (SA-3 — the /devices BulkBar "Run script" deep-link passes hosts=).
    const hasAdHoc = Array.isArray(body.deviceIds) && body.deviceIds.length > 0
    if (body.groupId || hasAdHoc) {
      // Each per-device runScript writes its own audit row; this route's
      // withAudit wraps the operator's intent ("ran script X on N hosts").
      let resolved: Array<{ id: string; clientName: string }>
      let scopeLabel: string
      if (body.groupId) {
        resolved = await resolveGroupTargets(body.groupId)
        scopeLabel = `group ${body.groupId}`
      } else {
        // Only active devices the ids actually resolve to (drops stale ids).
        resolved = await prisma.fl_Device.findMany({
          where: { id: { in: body.deviceIds! }, isActive: true },
          select: { id: true, clientName: true },
        })
        scopeLabel = `${resolved.length} selected hosts`
      }
      if (resolved.length === 0) {
        return NextResponse.json(
          { error: `${scopeLabel} resolves to 0 active devices` },
          { status: 400 },
        )
      }

      // SEC-3 — fan-out is the highest-blast-radius operator action. Gate
      // on the tenant's bulkApprovalThreshold via 4-eyes before the loop.
      const tenantName = resolved[0].clientName
      const gatedPayload = {
        scriptId: id,
        targets: resolved.map((d) => d.id).sort(),
        dryRun: body.dryRun ?? false,
        args: body.args ?? [],
      }
      const { hex: payloadHash } = hashPayload(gatedPayload)
      const gate = await shouldRequireApproval("bulk.dispatch", tenantName, {
        deviceCount: resolved.length,
      })
      if (gate.required) {
        if (!body.approvalId) {
          const approval = await requireApproval({
            action: "bulk.dispatch",
            tenantName,
            payload: gatedPayload,
            scope: `script ${id} → ${scopeLabel} (${resolved.length} devices)`,
            requestedBy: session.email,
          })
          addAuditDetail(req, { approvalRequested: approval.approvalId, reason: gate.reason })
          return NextResponse.json(
            { status: "approval-required", approvalId: approval.approvalId, reason: gate.reason, deviceCount: resolved.length },
            { status: 202 },
          )
        }
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

      const results: Array<{ deviceId: string; ok: boolean; runId?: string; error?: string }> = []
      for (const d of resolved) {
        try {
          const run = await runScript({
            scriptId: id,
            deviceId: d.id,
            initiatedBy: session.email,
            dryRun: body.dryRun,
            args: body.args,
            env: body.env,
          })
          results.push({ deviceId: d.id, ok: true, runId: run.id })
        } catch (err) {
          results.push({
            deviceId: d.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      return NextResponse.json({ count: results.length, results }, { status: 201 })
    }

    if (!body.deviceId) {
      return NextResponse.json({ error: "deviceId or groupId required" }, { status: 400 })
    }
    try {
      const run = await runScript({
        scriptId: id,
        deviceId: body.deviceId,
        initiatedBy: session.email,
        dryRun: body.dryRun,
        args: body.args,
        env: body.env,
      })
      return NextResponse.json(run, { status: 201 })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    }
  },
)
