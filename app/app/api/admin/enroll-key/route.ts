import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { buildKeyInstallLinks, generateEnrollKey } from "@/lib/agent-enroll"

// Deploy-on-the-fly (2026-09-13) — per-tenant enrollment key management.
//
//   GET  ?tenantName=X            → current key state + install links +
//                                   the tenant's recent enrollments
//   POST { tenantName, action }   → ensure | rotate | disable | enable
//
// ADMIN-only. The key itself is returned (it's the install link; the
// Install tab shows it permanently, unlike one-time tokens). Rotation
// is audited with the old prefix so a leaked-link incident is traceable.

export const dynamic = "force-dynamic"

function base(): string {
  return process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com"
}

async function stateFor(tenantName: string) {
  const t = await prisma.fl_Tenant.findUnique({
    where: { name: tenantName },
    select: { name: true, enrollKey: true, enrollKeyEnabled: true, enrollKeyRotatedAt: true },
  })
  if (!t) return null
  const recent = await prisma.fl_AgentRegistration.findMany({
    where: { tenantName },
    orderBy: { enrolledAt: "desc" },
    take: 12,
    select: { id: true, hostname: true, os: true, enrolledAt: true, lastSeenAt: true, isRevoked: true, enrolledByToken: true },
  })
  return {
    tenantName: t.name,
    key: t.enrollKey,
    enabled: t.enrollKeyEnabled,
    rotatedAt: t.enrollKeyRotatedAt,
    links: t.enrollKey ? buildKeyInstallLinks(t.enrollKey, base()) : null,
    recent: recent.map((r) => ({
      ...r,
      viaKey: r.enrolledByToken?.startsWith("key:") ?? false,
    })),
  }
}

export async function GET(req: NextRequest) {
  await requireAdmin()
  const tenantName = req.nextUrl.searchParams.get("tenantName")?.trim()
  if (!tenantName) return NextResponse.json({ error: "tenantName required" }, { status: 400 })
  const state = await stateFor(tenantName)
  if (!state) return NextResponse.json({ error: "tenant not found" }, { status: 404 })
  return NextResponse.json(state)
}

export const POST = withAudit(
  { action: "enroll-key.changed", redactKeys: ["key"] },
  async (req: NextRequest) => {
    await requireAdmin()
    const body = (await req.json().catch(() => ({}))) as {
      tenantName?: string
      action?: "ensure" | "rotate" | "disable" | "enable"
    }
    const tenantName = body.tenantName?.trim()
    const action = body.action ?? "ensure"
    if (!tenantName) return NextResponse.json({ error: "tenantName required" }, { status: 400 })
    const t = await prisma.fl_Tenant.findUnique({
      where: { name: tenantName },
      select: { enrollKey: true },
    })
    if (!t) return NextResponse.json({ error: "tenant not found" }, { status: 404 })

    const data: { enrollKey?: string; enrollKeyEnabled?: boolean; enrollKeyRotatedAt?: Date } = {}
    if (action === "rotate" || (action === "ensure" && !t.enrollKey)) {
      data.enrollKey = generateEnrollKey()
      data.enrollKeyRotatedAt = new Date()
      data.enrollKeyEnabled = true
    }
    if (action === "disable") data.enrollKeyEnabled = false
    if (action === "enable") data.enrollKeyEnabled = true
    if (Object.keys(data).length) {
      await prisma.fl_Tenant.update({ where: { name: tenantName }, data })
    }
    addAuditDetail(req, {
      tenantName,
      action,
      previousKeyPrefix: t.enrollKey?.slice(0, 8) ?? null,
      newKeyPrefix: data.enrollKey?.slice(0, 8) ?? null,
    })
    return NextResponse.json(await stateFor(tenantName))
  },
)
