import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"
import { rotate } from "@/lib/credential-vault"

// Phase 11 WS-A.8 — credential PATCH (rotation) and DELETE.

export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const row = await prisma.fl_Credential.findFirst({
    where: { id, replacedAt: null },
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
  })
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })
  // Disclosure log preview for the UI.
  const disclosures = await prisma.fl_CredentialDisclosureLog.findMany({
    where: { credentialId: id },
    orderBy: { viewedAt: "desc" },
    take: 20,
    select: {
      id: true,
      viewedBy: true,
      viewedAt: true,
      justification: true,
      ip: true,
      userAgent: true,
      context: true,
    },
  })
  return NextResponse.json({ credential: row, disclosures })
}

export const PATCH = withAudit(
  {
    action: "credential.update",
    redactKeys: ["newPlaintext"],
  },
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin()
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as {
      newPlaintext?: string
      label?: string
      rotateBy?: string | null
    }
    // Branch 1: rotate plaintext (full rewrap, replacedAt on old row).
    if (typeof body.newPlaintext === "string" && body.newPlaintext.length > 0) {
      const rotated = await rotate({
        credentialId: id,
        newPlaintext: body.newPlaintext,
        actorEmail: session.email,
      })
      addAuditDetail(req, {
        credentialId: id,
        rotatedToId: rotated.id,
        newPlaintext: "[never-store-plaintext-in-audit]",
      })
      return NextResponse.json({ ok: true, id: rotated.id })
    }
    // Branch 2: edit metadata (label / rotateBy) — no plaintext touched.
    const data: { label?: string; rotateBy?: Date | null } = {}
    if (typeof body.label === "string") data.label = body.label.trim()
    if (body.rotateBy !== undefined) {
      data.rotateBy = body.rotateBy ? new Date(body.rotateBy) : null
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "no fields to update" },
        { status: 400 },
      )
    }
    await prisma.fl_Credential.update({ where: { id }, data })
    addAuditDetail(req, { credentialId: id, fields: Object.keys(data) })
    return NextResponse.json({ ok: true })
  },
)

export const DELETE = withAudit(
  { action: "credential.delete" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    // Soft-delete via replacedAt (forensic continuity, cascade to
    // disclosure log preserved). Cascade behavior on Fl_Credential
    // deletion is `onDelete: Cascade` for the FK, so a true delete
    // would erase history — refuse and use the soft-delete.
    await prisma.fl_Credential.update({
      where: { id },
      data: { replacedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  },
)
