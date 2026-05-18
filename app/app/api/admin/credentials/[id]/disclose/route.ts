import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { unseal } from "@/lib/credential-vault"
import { consumeStepUp } from "@/lib/step-up"
import {
  shouldRequireApproval,
  requireApproval,
  consumeApproval,
  hashPayload,
} from "@/lib/approval-gate"

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
      approvalId?: string
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
      select: { id: true, tenantName: true, label: true, kind: true },
    })
    if (!cred) return NextResponse.json({ error: "not found" }, { status: 404 })

    // Tenant policy gate. v1: when disclosureRequiresApproval=true,
    // the request goes through 4-eyes. WS-B.3 produces the approval
    // on first call (returns 202) and consumes it on second call
    // (body.approvalId present).
    const gate = await shouldRequireApproval(
      "credential.disclose",
      cred.tenantName,
    )
    if (gate.required) {
      const gatedPayload = { id, kind: cred.kind }
      const { hex: payloadHash } = hashPayload(gatedPayload)
      if (!body.approvalId) {
        const result = await requireApproval({
          action: "credential.disclose",
          tenantName: cred.tenantName,
          payload: gatedPayload,
          scope: `${cred.kind} · ${cred.label}`,
          requestedBy: userEmail,
        })
        addAuditDetail(req, { approvalRequested: result.approvalId, reason: gate.reason })
        return NextResponse.json(
          {
            status: "approval-required",
            approvalId: result.approvalId,
            reason: gate.reason,
          },
          { status: 202 },
        )
      }
      const consumed = await consumeApproval({
        approvalId: body.approvalId,
        action: "credential.disclose",
        payloadHash,
      })
      if (!consumed.ok) {
        return NextResponse.json({ error: consumed.reason }, { status: consumed.status })
      }
      addAuditDetail(req, { approvalConsumed: body.approvalId })
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
