import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { runScript } from "@/lib/script-commands"
import { withAudit } from "@/lib/with-audit"
import { resolveGroupTargets } from "@/lib/targeting"

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
    const session = await requireSession()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      deviceId?: string
      groupId?: string
      dryRun?: boolean
      args?: string[]
      env?: Record<string, string>
    }

    if (body.groupId) {
      // Fan-out path. Each per-device runScript writes its own audit row;
      // this route's withAudit wraps the operator's intent ("ran script X
      // on group Y").
      const resolved = await resolveGroupTargets(body.groupId)
      if (resolved.length === 0) {
        return NextResponse.json(
          { error: `group ${body.groupId} resolves to 0 active devices` },
          { status: 400 },
        )
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
      return NextResponse.json({ groupId: body.groupId, count: results.length, results }, { status: 201 })
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
