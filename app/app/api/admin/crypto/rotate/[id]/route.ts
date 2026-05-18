import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"

// Phase 12 WS-C.3 — rotation progress polling.

export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const row = await prisma.fl_CryptoRotation.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({
    id: row.id,
    purpose: row.purpose,
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    state: row.state,
    processed: row.processed,
    total: row.total,
    currentTenant: row.currentTenant,
    errorMsg: row.errorMsg,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  })
}
