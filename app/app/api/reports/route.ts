import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { SUPPORTED_KINDS, type ReportKind } from "@/lib/reports/render"

// GET — list recent reports, newest first.
// Filterable by tenantName / kind via query string.
export async function GET(req: NextRequest) {
  await requireSession()
  const url = new URL(req.url)
  const tenantName = url.searchParams.get("tenantName") ?? undefined
  const kind = url.searchParams.get("kind") ?? undefined
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50))
  const reports = await prisma.fl_Report.findMany({
    where: {
      ...(tenantName ? { tenantName } : {}),
      ...(kind ? { kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return NextResponse.json({ reports })
}

// POST — create a new report row in state="queued".
// Body: { kind, tenantName, audience?, asOf? (ISO), startDate?, endDate?, format? }
export async function POST(req: NextRequest) {
  const session = await requireSession()
  const body = (await req.json().catch(() => ({}))) as {
    kind?: string
    tenantName?: string
    audience?: string
    asOf?: string
    startDate?: string
    endDate?: string
    format?: string
  }
  if (!body.kind || !SUPPORTED_KINDS.includes(body.kind as ReportKind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${SUPPORTED_KINDS.join(", ")}` },
      { status: 400 },
    )
  }
  if (!body.tenantName?.trim()) {
    return NextResponse.json({ error: "tenantName required" }, { status: 400 })
  }
  const audience = (body.audience ?? "client").toLowerCase()
  if (!["tech", "client", "auditor"].includes(audience)) {
    return NextResponse.json({ error: "audience must be tech | client | auditor" }, { status: 400 })
  }

  // Per-tenant retention default.
  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: body.tenantName },
    select: { reportRetentionDays: true },
  })
  const retentionDays = tenant?.reportRetentionDays ?? 2190
  const retentionUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)

  const report = await prisma.fl_Report.create({
    data: {
      kind: body.kind,
      tenantName: body.tenantName,
      audience,
      asOf: body.asOf ? new Date(body.asOf) : null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      format: body.format ?? "pdf",
      generatedBy: session.email,
      retentionUntil,
      state: "queued",
    },
  })
  return NextResponse.json(report, { status: 201 })
}
