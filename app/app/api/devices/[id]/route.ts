import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// PATCH /api/devices/[id]
// Body: {
//   friendlyName?: string | null,
//   // INV-3 — asset/warranty fields (columns already exist on Fl_Device;
//   // the PATCH just never accepted them). Unblocks the warranty report.
//   assetTag?: string | null,
//   purchasedAt?: string | null,          // ISO date
//   purchasePriceCents?: number | null,   // integer cents
//   warrantyExpiresAt?: string | null,    // ISO date
// }
// Trim + collapse-empty-to-null so the search index doesn't trip on
// blank strings.

/** Parse an ISO date field to Date|null|undefined(=not supplied/invalid). */
function parseDateField(v: unknown): Date | null | undefined {
  if (v === null) return null
  if (typeof v !== "string" || v.trim() === "") return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    friendlyName?: string | null
    assetTag?: string | null
    purchasedAt?: string | null
    purchasePriceCents?: number | null
    warrantyExpiresAt?: string | null
  }

  const data: {
    friendlyName?: string | null
    assetTag?: string | null
    purchasedAt?: Date | null
    purchasePriceCents?: number | null
    warrantyExpiresAt?: Date | null
  } = {}
  if ("friendlyName" in body) {
    const trimmed = typeof body.friendlyName === "string" ? body.friendlyName.trim() : ""
    data.friendlyName = trimmed === "" ? null : trimmed.slice(0, 120)
  }
  if ("assetTag" in body) {
    const trimmed = typeof body.assetTag === "string" ? body.assetTag.trim() : ""
    data.assetTag = trimmed === "" ? null : trimmed.slice(0, 120)
  }
  if ("purchasedAt" in body) {
    const d = parseDateField(body.purchasedAt)
    if (d !== undefined || body.purchasedAt === null) data.purchasedAt = d ?? null
  }
  if ("warrantyExpiresAt" in body) {
    const d = parseDateField(body.warrantyExpiresAt)
    if (d !== undefined || body.warrantyExpiresAt === null) data.warrantyExpiresAt = d ?? null
  }
  if ("purchasePriceCents" in body) {
    const v = body.purchasePriceCents
    data.purchasePriceCents =
      v === null
        ? null
        : typeof v === "number" && Number.isInteger(v) && v >= 0
          ? v
          : undefined
    if (data.purchasePriceCents === undefined) delete data.purchasePriceCents
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no editable fields supplied" }, { status: 400 })
  }

  const before = await prisma.fl_Device.findUnique({
    where: { id },
    select: {
      id: true, clientName: true, hostname: true, friendlyName: true,
      assetTag: true, purchasedAt: true, purchasePriceCents: true, warrantyExpiresAt: true,
    },
  })
  if (!before) {
    return NextResponse.json({ error: "device not found" }, { status: 404 })
  }

  const after = await prisma.fl_Device.update({
    where: { id },
    data,
    select: {
      id: true, friendlyName: true, hostname: true, clientName: true,
      assetTag: true, purchasedAt: true, purchasePriceCents: true, warrantyExpiresAt: true,
    },
  })

  // Build a changes map over only the fields actually supplied.
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const k of Object.keys(data) as (keyof typeof data)[]) {
    changes[k] = { from: (before as Record<string, unknown>)[k], to: (after as Record<string, unknown>)[k] }
  }

  await writeAudit({
    actorEmail: session.email,
    clientName: after.clientName,
    deviceId: after.id,
    action: "device.update",
    outcome: "ok",
    detail: { changes },
  }).catch(() => {})

  return NextResponse.json(after)
}
