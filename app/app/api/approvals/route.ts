import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"

// Phase 11 WS-B.2 — list approvals. Default filter: pending +
// approved-but-not-yet-consumed, ordered newest first. ADMIN sees
// all; non-admin sees own-requested only.

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireSession()
  const state = req.nextUrl.searchParams.get("state")
  const tenant = req.nextUrl.searchParams.get("tenantName")
  const where: Record<string, unknown> = {}
  if (state) {
    where.state = state
  } else {
    // Default to actionable rows.
    where.state = { in: ["pending", "approved"] }
  }
  if (tenant) where.tenantName = tenant
  if (session.role !== "ADMIN") {
    where.requestedBy = session.email
  }
  const rows = await prisma.fl_ActionApproval.findMany({
    where,
    orderBy: { requestedAt: "desc" },
    take: 200,
  })
  return NextResponse.json({ approvals: rows })
}
