import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"
import { getSessionContext } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { REPORTS_DIR } from "@/lib/reports/render"

export const dynamic = "force-dynamic"

// GET /api/reports/[id]/download — streams the PDF.
// Auth: NextAuth session OR Bearer FLEETHUB_AGENT_SECRET. The bearer path
// is what scheduled email/Slack delivery will use once Fl_ReportSchedule
// lands; v1 also lets curl smoke-test the round trip.
export async function GET(
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
  const report = await prisma.fl_Report.findUnique({ where: { id } })
  if (!report) {
    return NextResponse.json({ error: "report not found" }, { status: 404 })
  }
  if (report.state !== "ready" && report.state !== "delivered") {
    return NextResponse.json(
      { error: `report not yet ready (state=${report.state})` },
      { status: 409 },
    )
  }

  const filepath = path.join(REPORTS_DIR, `${report.id}.pdf`)
  let buffer: Buffer
  try {
    buffer = await fs.readFile(filepath)
  } catch {
    return NextResponse.json(
      { error: "report file missing on disk (retention sweep or never generated)" },
      { status: 410 },
    )
  }

  const filename = `${report.kind}-${report.tenantName.replace(/\s+/g, "-")}-${report.id.slice(-6)}.pdf`
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "content-length": String(buffer.length),
    },
  })
}
