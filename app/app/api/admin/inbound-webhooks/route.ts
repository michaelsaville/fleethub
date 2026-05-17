import { NextRequest, NextResponse } from "next/server"
import { randomUUID, randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { writeAudit } from "@/lib/audit"
import { SUPPORTED_SOURCES } from "@/lib/inbound-mappers"

export const dynamic = "force-dynamic"

// Phase 8 Workstream A step 6 — create a new inbound webhook row.
// The route mints the bearer token server-side; the client never
// supplies it. Source must be one we have a mapper for; configJson
// (when present) must parse as JSON to keep malformed rows from
// breaking the receive path.

export async function POST(req: NextRequest) {
  const ctx = await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })
  if (name.length > 120) return NextResponse.json({ error: "name must be 120 chars or fewer" }, { status: 400 })

  const tenantName = typeof body.tenantName === "string" ? body.tenantName.trim() : ""
  if (!tenantName) return NextResponse.json({ error: "tenantName is required" }, { status: 400 })

  const source = typeof body.source === "string" ? body.source.trim() : ""
  if (!SUPPORTED_SOURCES.includes(source)) {
    return NextResponse.json(
      { error: `source must be one of: ${SUPPORTED_SOURCES.join(", ")}` },
      { status: 400 },
    )
  }

  // configJson is freeform per-source — we only validate it parses.
  // Mappers handle their own shape checks at receive time.
  let configJsonStr: string | null = null
  if (body.configJson !== undefined && body.configJson !== null && body.configJson !== "") {
    if (typeof body.configJson === "string") {
      try {
        JSON.parse(body.configJson)
      } catch {
        return NextResponse.json({ error: "configJson must be valid JSON" }, { status: 400 })
      }
      configJsonStr = body.configJson
    } else if (typeof body.configJson === "object") {
      configJsonStr = JSON.stringify(body.configJson)
    } else {
      return NextResponse.json({ error: "configJson must be a JSON string or object" }, { status: 400 })
    }
  }

  // Tenant sanity-check (same union the alert-routing form uses).
  const [tenantRow, devRow] = await Promise.all([
    prisma.fl_Tenant.findUnique({ where: { name: tenantName }, select: { name: true } }),
    prisma.fl_Device.findFirst({
      where: { isActive: true, clientName: tenantName },
      select: { id: true },
    }),
  ])
  if (!tenantRow && !devRow) {
    return NextResponse.json(
      { error: `Tenant "${tenantName}" not found (no Fl_Tenant row or active device with that clientName)` },
      { status: 400 },
    )
  }

  const id = randomUUID()
  // 32 random bytes → 64 hex chars. URL-safe + opaque enough that
  // bruteforcing isn't a concern.
  const token = randomBytes(32).toString("hex")
  const now = new Date()

  await prisma.$executeRaw`
    INSERT INTO fleethub.fl_inbound_webhooks
      (id, name, "tenantName", source, token, "configJson", "isActive",
       "createdBy", "fireCount", "errorCount", "createdAt", "updatedAt")
    VALUES
      (${id}, ${name}, ${tenantName}, ${source}, ${token}, ${configJsonStr},
       true, ${ctx.email}, 0, 0, ${now}, ${now})
  `

  await writeAudit({
    actorEmail: ctx.email,
    clientName: tenantName,
    action: "inbound.webhook.create",
    outcome: "ok",
    detail: { webhookId: id, name, source },
  }).catch(() => undefined)

  return NextResponse.json({ id, token }, { status: 201 })
}
