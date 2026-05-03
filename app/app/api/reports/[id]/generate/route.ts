import { NextRequest, NextResponse } from "next/server"
import { getSessionContext } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { generateReport } from "@/lib/reports/render"

// POST /api/reports/[id]/generate — runs the render synchronously.
// V1 has no background worker; the request stays open for ~1-3s while the
// PDF builds. Phase 5.5 swaps to a job queue (likely the same cron pattern
// as patches-scan).
//
// Auth: NextAuth session OR a bearer FLEETHUB_AGENT_SECRET. The bearer
// path is what scheduled generation will use once Fl_ReportSchedule lands;
// it also unblocks smoke-testing without a logged-in browser.
//
// Returns the updated report row with state=ready or state=failed.
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getSessionContext()
  if (!ctx) {
    const auth = req.headers.get("authorization") ?? ""
    const secret = process.env.FLEETHUB_AGENT_SECRET ?? ""
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
  }
  const { id } = await params
  const existing = await prisma.fl_Report.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: "report not found" }, { status: 404 })
  }
  if (existing.state === "generating" || existing.state === "ready" || existing.state === "delivered") {
    return NextResponse.json(
      { error: `report already ${existing.state}` },
      { status: 409 },
    )
  }
  try {
    await generateReport(id)
    const refreshed = await prisma.fl_Report.findUnique({ where: { id } })
    return NextResponse.json(refreshed)
  } catch (err) {
    const refreshed = await prisma.fl_Report.findUnique({ where: { id } })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), report: refreshed },
      { status: 500 },
    )
  }
}
