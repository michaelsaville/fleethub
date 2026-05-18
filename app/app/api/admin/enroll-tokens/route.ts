import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import {
  generateEnrollToken,
  buildBootstrapSnippets,
  ENROLL_TOKEN_TTL_HOURS_DEFAULT,
  ENROLL_TOKEN_TTL_HOURS_MAX,
} from "@/lib/agent-enroll"

// Phase 13 WS-D.0 — create a one-time agent bootstrap token.
// ADMIN-only. Returns the token + both bootstrap snippets. Token
// shown ONCE — operator's responsibility to copy.

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "enroll-token.created", redactKeys: ["token"] },
  async (req: NextRequest) => {
    await requireAdmin()
    const body = (await req.json().catch(() => ({}))) as {
      tenantName?: string
      ttlHours?: number
    }
    if (!body.tenantName?.trim()) {
      return NextResponse.json(
        { error: "tenantName required" },
        { status: 400 },
      )
    }
    // Verify tenant exists (FK-like check; helps the operator).
    const tenant = await prisma.fl_Tenant.findUnique({
      where: { name: body.tenantName.trim() },
      select: { id: true },
    })
    if (!tenant) {
      return NextResponse.json(
        { error: `tenant ${body.tenantName} not found` },
        { status: 404 },
      )
    }

    const ttl = Math.min(
      Math.max(body.ttlHours ?? ENROLL_TOKEN_TTL_HOURS_DEFAULT, 1),
      ENROLL_TOKEN_TTL_HOURS_MAX,
    )
    const token = generateEnrollToken()
    const expiresAt = new Date(Date.now() + ttl * 3600_000)

    const baseUrl =
      process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com"

    const { unix, windows } = buildBootstrapSnippets(token, baseUrl)

    await prisma.fl_EnrollToken.create({
      data: {
        token,
        tenantName: body.tenantName.trim(),
        createdBy: "(captured via withAudit)",
        expiresAt,
      },
    })

    addAuditDetail(req, {
      tenant: body.tenantName.trim(),
      ttlHours: ttl,
      token: "[REDACTED]", // belt-and-suspenders with redactKeys above
    })

    return NextResponse.json({
      token,
      expiresAt: expiresAt.toISOString(),
      bootstrapSnippetUnix: unix,
      bootstrapSnippetWindows: windows,
    })
  },
)
