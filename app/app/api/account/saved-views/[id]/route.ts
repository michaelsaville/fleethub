import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { parseSavedViews, serializeSavedViews } from "@/lib/saved-views"

// Phase 12 WS-D.4 — saved-view delete by id.

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
  if (!userId) return NextResponse.json({ error: "no user id" }, { status: 500 })
  const { id } = await params
  const user = await prisma.fl_StaffUser.findUnique({
    where: { id: userId },
    select: { savedViewsJson: true },
  })
  const env = parseSavedViews(user?.savedViewsJson ?? null)
  const before = env.views.length
  env.views = env.views.filter((v) => v.id !== id)
  if (env.views.length === before) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  await prisma.fl_StaffUser.update({
    where: { id: userId },
    data: { savedViewsJson: serializeSavedViews(env) },
  })
  return NextResponse.json({ ok: true })
}
