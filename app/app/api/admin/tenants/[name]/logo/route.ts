import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { UPLOADS_DIR } from "@/lib/uploads"

// Upload a tenant report logo. Mirrors SM's category-icon upload pattern
// but writes under FleetHub's UPLOADS_DIR (default /tmp/fleethub-uploads,
// matching the REPORTS_DIR ephemerality story — Phase 5.5 swaps both to
// durable storage).
//
// Returns { url: "/api/uploads/tenant-logos/<file>" }. Caller persists
// onto Fl_Tenant.reportLogoUrl via PATCH /api/admin/tenants/[name].

const MAX_FILE_SIZE = 2 * 1024 * 1024
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  await requireSession()
  const { name } = await params
  const tenantName = decodeURIComponent(name)

  // Tenant must exist before we attach a logo to it.
  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: tenantName },
    select: { id: true },
  })
  if (!tenant) {
    return NextResponse.json({ error: `tenant not found: ${tenantName}` }, { status: 404 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    // No SVG / GIF — @react-pdf/renderer Image only handles raster formats
    // reliably. PNG with transparency is the recommended logo format.
    return NextResponse.json(
      { error: "File must be PNG, JPEG, or WebP" },
      { status: 400 },
    )
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File must be under 2 MB" }, { status: 400 })
  }

  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png"
  const filename = `${randomUUID()}.${ext}`
  const dir = join(UPLOADS_DIR, "tenant-logos")

  try {
    await mkdir(dir, { recursive: true })
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(join(dir, filename), buffer)
    const url = `/api/uploads/tenant-logos/${filename}`
    return NextResponse.json({ url })
  } catch (err) {
    console.error("[admin/tenants/logo] upload failed:", err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
