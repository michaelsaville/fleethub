import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { bulkSetMaintenance } from "@/lib/maintenance"

// POST /api/devices/maintenance/bulk
// Body: { deviceIds: string[], on: boolean, until?: ISO, reason?: string }
export async function POST(req: NextRequest) {
  const session = await requireSession()
  const body = (await req.json().catch(() => ({}))) as {
    deviceIds?: string[]
    on?: boolean
    until?: string | null
    reason?: string | null
  }
  if (!Array.isArray(body.deviceIds) || body.deviceIds.length === 0) {
    return NextResponse.json({ error: "deviceIds required" }, { status: 400 })
  }
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "on (boolean) required" }, { status: 400 })
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
}
