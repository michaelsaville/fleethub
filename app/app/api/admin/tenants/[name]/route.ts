import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"

// PATCH branding-related Fl_Tenant fields. v1 surface: reportLogoUrl,
// reportAccentColor, reportFooterText. Auto-creates the Fl_Tenant row
// if it doesn't exist yet (some tenants only have rows in Fl_Device
// until they're explicitly configured).
//
// Body: any subset of { reportLogoUrl, reportAccentColor, reportFooterText }
// Pass null on a field to clear it (logoUrl null = remove the logo).

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  await requireSession()
  const { name } = await params
  const tenantName = decodeURIComponent(name)

  const body = (await req.json().catch(() => ({}))) as {
    reportLogoUrl?: string | null
    reportAccentColor?: string | null
    reportFooterText?: string | null
  }

  if (
    body.reportAccentColor !== undefined &&
    body.reportAccentColor !== null &&
    !HEX_COLOR_RE.test(body.reportAccentColor)
  ) {
    return NextResponse.json(
      { error: "reportAccentColor must be a 6-digit hex like #F97316" },
      { status: 400 },
    )
  }

  // Build an update payload from only the fields the caller actually sent.
  const data: Record<string, unknown> = {}
  if (body.reportLogoUrl !== undefined) data.reportLogoUrl = body.reportLogoUrl
  if (body.reportAccentColor !== undefined) {
    data.reportAccentColor = body.reportAccentColor ?? "#F97316"
  }
  if (body.reportFooterText !== undefined) data.reportFooterText = body.reportFooterText

  // Upsert because some clients don't have an Fl_Tenant row yet.
  const tenant = await prisma.fl_Tenant.upsert({
    where: { name: tenantName },
    update: data,
    create: { name: tenantName, ...data },
    select: {
      name: true,
      reportLogoUrl: true,
      reportAccentColor: true,
      reportFooterText: true,
    },
  })
  return NextResponse.json({ tenant })
}
