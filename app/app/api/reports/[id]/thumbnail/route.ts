import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { REPORTS_DIR } from "@/lib/reports/render"
import {
  renderFirstPagePng,
  verifyThumbnailToken,
} from "@/lib/pdf-thumbnail"

export const dynamic = "force-dynamic"

// GET /api/reports/[id]/thumbnail?token=<hmac>
//
// Public-by-design: Slack and Teams render image blocks by fetching the
// URL with no auth, so a session check would block them. Gating is via
// HMAC token tied to the report id (see lib/pdf-thumbnail.ts) — same
// blast radius as the existing /download bearer-secret path, only over
// a stable per-report URL.
//
// The thumbnail is cached next to the PDF in REPORTS_DIR so repeat fetches
// (re-deliveries, manual refresh) skip the pdftoppm round trip.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const token = req.nextUrl.searchParams.get("token") ?? ""
  if (!verifyThumbnailToken(id, token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

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

  const pdfPath = path.join(REPORTS_DIR, `${report.id}.pdf`)
  const thumbPath = path.join(REPORTS_DIR, `${report.id}-thumb.png`)

  let png: Buffer
  try {
    png = await fs.readFile(thumbPath)
  } catch {
    try {
      png = await renderFirstPagePng(pdfPath)
      await fs.writeFile(thumbPath, png)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `thumbnail render failed: ${msg}` }, { status: 500 })
    }
  }

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(png.length),
      // Slack/Teams cache server-side; no need for browser caching.
      "cache-control": "public, max-age=300",
    },
  })
}
