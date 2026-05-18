import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// Phase 11 WS-C.6 — remove a WebAuthn credential. Users may only
// delete their own credentials; admins use a separate /api/admin/...
// surface (not in v1) if they need cross-user revocation.

export const dynamic = "force-dynamic"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 })
  }
  const userId = (session.user as { id?: string }).id
  if (!userId) {
    return NextResponse.json({ error: "session has no user id" }, { status: 500 })
  }
  const { id } = await params
  const cred = await prisma.fl_WebAuthnCred.findUnique({ where: { id } })
  if (!cred) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (cred.userId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  await prisma.fl_WebAuthnCred.delete({ where: { id } })
  await writeAudit({
    actorEmail: (session.user as { email?: string }).email ?? null,
    action: "webauthn.cred.delete",
    outcome: "ok",
    detail: { credId: id, name: cred.name },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}
