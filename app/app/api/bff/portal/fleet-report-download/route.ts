import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { verifyHmac } from "@/lib/bff-hmac"
import { mintReportDownloadToken } from "@/lib/portal-download-token"

// Phase 8 Workstream D step 6.2 — mint a signed, short-lived URL
// the customer portal can hand a logged-in user. The URL hits the
// existing /api/reports/[id]/download route; that route validates
// the token and streams the PDF/ZIP.
//
// Tenant binding is enforced HERE — the BFF refuses to mint a token
// for a report belonging to a different client than the portal user's
// active link. The download route only validates that the token
// belongs to the report id in the URL, so this is the only checkpoint
// for "you don't own this report."

export const dynamic = "force-dynamic"

interface Body {
  portalUserId?: string
  clientName?: string
  reportId?: string
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const verify = verifyHmac(
    rawBody,
    req.headers.get("x-portal-signature"),
    req.headers.get("x-portal-timestamp"),
    process.env.PORTAL_BFF_SECRET ?? "",
  )
  if (!verify.ok) return NextResponse.json({ error: verify.reason }, { status: verify.status })

  let body: Body
  try { body = JSON.parse(rawBody) as Body } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const clientName = body.clientName?.trim()
  const portalUserId = body.portalUserId?.trim() ?? ""
  const reportId = body.reportId?.trim()
  if (!clientName || !reportId) {
    return NextResponse.json({ error: "clientName and reportId required" }, { status: 400 })
  }

  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: clientName },
    select: { portalEnabled: true },
  })
  if (!tenant?.portalEnabled) {
    return NextResponse.json({ error: "portal not enabled for this client" }, { status: 403 })
  }

  const report = await prisma.fl_Report.findUnique({
    where: { id: reportId },
    select: { id: true, tenantName: true, state: true, audience: true, kind: true, format: true },
  })
  if (!report) {
    return NextResponse.json({ error: "report not found" }, { status: 404 })
  }
  // Tenant-bind: the report must belong to this client. The portal
  // shouldn't even surface other clients' reports, but enforce here
  // because the BFF is the trust boundary.
  if (report.tenantName !== clientName) {
    return NextResponse.json({ error: "report does not belong to this client" }, { status: 403 })
  }
  // Audience tech / auditor reports are intentionally not customer-
  // facing. /fleet/reports already filters those out, but the BFF
  // refuses to mint a token regardless of how the request got here.
  if (report.audience !== "client") {
    return NextResponse.json({ error: "report not available to client audience" }, { status: 403 })
  }
  if (report.state === "expired") {
    return NextResponse.json({ error: "report has expired" }, { status: 410 })
  }
  if (report.state !== "ready" && report.state !== "delivered") {
    return NextResponse.json({ error: `report not yet ready (state=${report.state})` }, { status: 409 })
  }

  const { t, s } = mintReportDownloadToken(report.id, process.env.PORTAL_BFF_SECRET ?? "")
  const publicUrl = (process.env.FLEETHUB_PUBLIC_URL || "https://fleethub.pcc2k.com").replace(/\/$/, "")
  const downloadUrl = `${publicUrl}/api/reports/${encodeURIComponent(report.id)}/download?t=${encodeURIComponent(t)}&s=${encodeURIComponent(s)}`

  await writeAudit({
    clientName,
    action: "portal.fleet.report.download.minted",
    outcome: "ok",
    detail: {
      portalUserId,
      reportId: report.id,
      kind: report.kind,
      format: report.format,
      expMs: t,
    },
  }).catch(() => undefined)

  return NextResponse.json({
    url: downloadUrl,
    // Expiry in ms — UI can show a countdown if it wants.
    expiresAt: parseInt(t, 10),
  })
}
