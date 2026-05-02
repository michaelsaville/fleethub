import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { runScript } from "@/lib/script-commands"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    deviceId?: string
    dryRun?: boolean
    args?: string[]
    env?: Record<string, string>
  }
  if (!body.deviceId) {
    return NextResponse.json({ error: "deviceId required" }, { status: 400 })
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
}
