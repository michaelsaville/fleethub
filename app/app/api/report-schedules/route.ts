import { NextRequest, NextResponse } from "next/server"
import { CronExpressionParser } from "cron-parser"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { SUPPORTED_KINDS, type ReportKind } from "@/lib/reports/render"

// CRUD over Fl_ReportSchedule. v1 = list + create + delete (delete via
// the [id] route below). Edit deferred — operators can delete and
// re-create. PHASE-5-DESIGN §8 has the full schedule editor on the
// roadmap; this is the minimum viable surface.

const ALLOWED_DATE_RANGES = [
  "last-7d",
  "last-30d",
  "last-90d",
  "month-to-date",
  "quarter-to-date",
] as const

export async function GET() {
  await requireSession()
  const schedules = await prisma.fl_ReportSchedule.findMany({
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({ schedules })
}

export async function POST(req: NextRequest) {
  const session = await requireSession()
  const body = (await req.json().catch(() => ({}))) as {
    tenantName?: string
    kind?: string
    audience?: string
    cron?: string
    timezone?: string
    dateRange?: string
    emailTo?: string
    emailCc?: string
  }

  if (!body.tenantName?.trim()) {
    return NextResponse.json({ error: "tenantName required" }, { status: 400 })
  }
  if (!body.kind || !SUPPORTED_KINDS.includes(body.kind as ReportKind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${SUPPORTED_KINDS.join(", ")}` },
      { status: 400 },
    )
  }
  const audience = (body.audience ?? "client").toLowerCase()
  if (!["tech", "client", "auditor"].includes(audience)) {
    return NextResponse.json({ error: "audience must be tech | client | auditor" }, { status: 400 })
  }
  if (!body.cron?.trim()) {
    return NextResponse.json({ error: "cron required (e.g. '0 8 * * 1')" }, { status: 400 })
  }
  // Validate cron up front so a typo can't lurk and silently break the worker.
  try {
    CronExpressionParser.parse(body.cron, { tz: body.timezone || "UTC" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `cron parse failed: ${msg}` }, { status: 400 })
  }
  const dateRange = body.dateRange ?? "last-30d"
  if (!ALLOWED_DATE_RANGES.includes(dateRange as (typeof ALLOWED_DATE_RANGES)[number])) {
    return NextResponse.json(
      { error: `dateRange must be one of: ${ALLOWED_DATE_RANGES.join(", ")}` },
      { status: 400 },
    )
  }

  const emailTo = (body.emailTo ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const emailCc = (body.emailCc ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (emailTo.length === 0) {
    return NextResponse.json(
      { error: "At least one email recipient required (emailTo)" },
      { status: 400 },
    )
  }
  for (const addr of [...emailTo, ...emailCc]) {
    if (!addr.includes("@")) {
      return NextResponse.json({ error: `invalid email address: ${addr}` }, { status: 400 })
    }
  }

  const schedule = await prisma.fl_ReportSchedule.create({
    data: {
      tenantName: body.tenantName,
      kind: body.kind,
      audience,
      cron: body.cron,
      timezone: body.timezone || "UTC",
      dateRange,
      deliveryJson: JSON.stringify({
        email: { to: emailTo, ...(emailCc.length > 0 ? { cc: emailCc } : {}) },
      }),
      createdBy: session.email,
      isActive: true,
    },
  })
  return NextResponse.json(schedule, { status: 201 })
}
