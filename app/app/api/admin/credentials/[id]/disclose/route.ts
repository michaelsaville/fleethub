import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { unseal } from "@/lib/credential-vault"
import { consumeStepUp } from "@/lib/step-up"

// Phase 11 WS-A.7 — credential disclose. The plaintext path.
//
// Required: valid step-up token in X-FleetHub-StepUp header.
// When the tenant has disclosureRequiresApproval=true, the route
// ALSO needs a valid approval consumption — that path lands when
// WS-B.3 wires the approval gate.
//
// Audit row is wrapped via withAudit + redactKeys to keep the
// plaintext out of the hash-chained log. The disclosure-log row
// (Fl_CredentialDisclosureLog) captures the full operator context
// without the plaintext.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export const POST = withAudit(
  {
    action: "credential.disclose",
    redactKeys: ["plaintext"],
  },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "not signed in" }, { status: 401 })
    }
    const userId = (session.user as { id?: string }).id
    const userEmail = (session.user as { email?: string }).email
    if (!userId || !userEmail) {
      return NextResponse.json({ error: "session lacks identity" }, { status: 500 })
    }
    // Step-up gate. Consumes the token; replay returns 409.
    const stepUp = await consumeStepUp(req, userId)
    if (!stepUp.ok) {
      return NextResponse.json({ error: stepUp.reason }, { status: stepUp.status })
    }
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      justification?: string
      context?: string
    }
    const justification = body.justification?.trim() ?? ""
    if (!justification) {
      return NextResponse.json(
        { error: "justification required for disclose" },
        { status: 400 },
      )
    }

    // Load credential first so we can audit even on tenant policy gate.
    const cred = await prisma.fl_Credential.findFirst({
      where: { id, replacedAt: null },
      select: { id: true, tenantName: true },
    })
    if (!cred) return NextResponse.json({ error: "not found" }, { status: 404 })

    // Tenant policy gate. v1: when disclosureRequiresApproval=true,
    // route refuses unless WS-B.3 has wired an approval token. v1
    // ships the refusal so the policy starts working immediately;
    // WS-B.3 unlocks the approve path on the same release wave.
    const tenant = await prisma.fl_Tenant.findUnique({
      where: { name: cred.tenantName },
      select: { disclosureRequiresApproval: true },
    })
    if (tenant?.disclosureRequiresApproval) {
      const hasApproval = req.headers.get("X-FleetHub-Approval") != null
      if (!hasApproval) {
        return NextResponse.json(
          { error: "tenant requires peer approval — POST /api/approvals first" },
          { status: 403 },
        )
      }
      // WS-B.3 will verify the approval token here.
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
    const userAgent = req.headers.get("user-agent") ?? null
    const result = await unseal({
      credentialId: id,
      actorEmail: userEmail,
      justification,
      ip,
      userAgent,
      context: body.context?.trim() || "ui-disclose",
    })
    addAuditDetail(req, {
      credentialId: id,
      tenantName: result.tenantName,
      kind: result.kind,
      label: result.label,
      justification,
      // Belt + suspenders: even though redactKeys handles this, write
      // a sentinel so it's obvious in a malformed-row case.
      plaintext: "[never-store-plaintext-in-audit]",
    })
    return NextResponse.json({
      plaintext: result.plaintext,
      label: result.label,
      kind: result.kind,
      tenantName: result.tenantName,
    })
  },
)
