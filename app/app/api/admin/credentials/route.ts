import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { seal, type CredentialKind } from "@/lib/credential-vault"

// Phase 11 WS-A.8 — credential vault CRUD entry points.
//
// GET  /api/admin/credentials?tenantName=…  list (no plaintext)
// POST /api/admin/credentials                seal a new credential
//
// The disclose route is separate: POST /api/credentials/[id]/disclose
// (gated on step-up token).

export const dynamic = "force-dynamic"

const KINDS: CredentialKind[] = [
  "admin-pw",
  "api-key",
  "wifi-psk",
  "snmp-v3",
  "smtp-password",
  "webhook-secret",
  "other",
]

export async function GET(req: NextRequest) {
  await requireAdmin()
  const tenantName = req.nextUrl.searchParams.get("tenantName")?.trim() || undefined
  const rows = await prisma.fl_Credential.findMany({
    where: { replacedAt: null, ...(tenantName ? { tenantName } : {}) },
    select: {
      id: true,
      tenantName: true,
      kind: true,
      label: true,
      keyVersion: true,
      rotateBy: true,
      lastAccessedAt: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ tenantName: "asc" }, { kind: "asc" }, { label: "asc" }],
  })
  return NextResponse.json({ credentials: rows })
}

export const POST = withAudit(
  {
    action: "credential.seal",
    // Redact the plaintext from the persisted audit detail. The
    // disclosure-log row carries no plaintext either; this is the
    // load-bearing safety for the hash-chained audit log.
    redactKeys: ["plaintext"],
  },
  async (req: NextRequest) => {
    const session = await requireAdmin()
    const body = (await req.json().catch(() => ({}))) as {
      tenantName?: string
      kind?: string
      label?: string
      plaintext?: string
      rotateBy?: string | null
    }
    if (
      !body.tenantName?.trim() ||
      !body.kind ||
      !body.label?.trim() ||
      !body.plaintext
    ) {
      return NextResponse.json(
        { error: "tenantName, kind, label, plaintext required" },
        { status: 400 },
      )
    }
    if (!KINDS.includes(body.kind as CredentialKind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${KINDS.join(", ")}` },
        { status: 400 },
      )
    }
    const sealed = await seal({
      tenantName: body.tenantName.trim(),
      kind: body.kind as CredentialKind,
      label: body.label.trim(),
      plaintext: body.plaintext,
      createdBy: session.email,
      rotateBy: body.rotateBy ? new Date(body.rotateBy) : null,
    })
    // Surface non-secret detail to the audit row. plaintext was
    // already redacted by the HOC's allowlist — verified by tests.
    addAuditDetail(req, {
      credentialId: sealed.id,
      tenantName: body.tenantName.trim(),
      kind: body.kind,
      label: body.label.trim(),
      plaintext: "[redacted-here-too-belt-and-suspenders]",
    })
    return NextResponse.json(
      { id: sealed.id, keyVersion: sealed.keyVersion },
      { status: 201 },
    )
  },
)
