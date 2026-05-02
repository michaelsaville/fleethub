import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { setMaintenance } from "@/lib/maintenance"

// POST /api/devices/[id]/maintenance
// Body: { on: boolean, until?: ISO string, reason?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    on?: boolean
    until?: string | null
    reason?: string | null
  }
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "on (boolean) required" }, { status: 400 })
  }
  try {
    const device = await setMaintenance({
      deviceId: id,
      on: body.on,
      until: body.until ? new Date(body.until) : null,
      reason: body.reason ?? null,
      setBy: session.email,
    })
    return NextResponse.json(device)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
