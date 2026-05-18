import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { withCronAuth } from "@/lib/with-cron-auth"

// Phase 13 / agent v1.0.2 WS-C — RustDesk peer-id ingest.
// Agent posts on every posture cycle (15min) with the latest read
// from the RustDesk config file. Null = RustDesk not installed or
// config file unreadable; agent's posture_remote_*.go falls back
// gracefully.
//
// Body shape:
//   {
//     "clientName": "Acme",
//     "hostname":   "web-1",
//     "rustdeskId": "123 456 789" | null
//   }
//
// Auth: Bearer FLEETHUB_AGENT_SECRET via withCronAuth (matches the
// existing /api/agent/posture/{backup,av} pattern).

export const dynamic = "force-dynamic"

interface Body {
  clientName?: string
  hostname?: string
  rustdeskId?: string | null
}

export const POST = withCronAuth<NextRequest>(async (req) => {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const clientName = body.clientName?.trim()
  const hostname = body.hostname?.trim()
  if (!clientName || !hostname) {
    return NextResponse.json(
      { error: "clientName and hostname required" },
      { status: 400 },
    )
  }
  const rustdeskId = body.rustdeskId?.trim() || null

  const device = await prisma.fl_Device.findFirst({
    where: { clientName, hostname },
    select: { id: true, rustdeskId: true },
  })
  if (!device) {
    return NextResponse.json(
      { error: `device not found: ${clientName}/${hostname}` },
      { status: 404 },
    )
  }

  // Only update if changed — avoids needless write storm at 15min
  // cadence. The audit row also only fires on actual change.
  if (device.rustdeskId !== rustdeskId) {
    await prisma.fl_Device.update({
      where: { id: device.id },
      data: { rustdeskId },
    })
    await writeAudit({
      clientName,
      deviceId: device.id,
      action: "posture.remote.report",
      outcome: "ok",
      detail: {
        rustdeskId: rustdeskId ?? null,
        previousRustdeskId: device.rustdeskId ?? null,
      },
    }).catch(() => undefined)
  }

  return NextResponse.json({ ok: true, changed: device.rustdeskId !== rustdeskId })
})
