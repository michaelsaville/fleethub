import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import {
  parseSavedViews,
  serializeSavedViews,
  SavedViewsEnvelope,
  type SavedView,
} from "@/lib/saved-views"

// Phase 12 WS-D.4 — saved-views read + upsert + delete.
//
// GET   /api/account/saved-views          → list
// PUT   /api/account/saved-views          → upsert a view by id
// DELETE /api/account/saved-views/[id]    → remove (separate file)

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 })
  }
  const userId = (session.user as { id?: string }).id
  if (!userId) return NextResponse.json({ error: "no user id" }, { status: 500 })
  const user = await prisma.fl_StaffUser.findUnique({
    where: { id: userId },
    select: { savedViewsJson: true },
  })
  const env = parseSavedViews(user?.savedViewsJson ?? null)
  return NextResponse.json(env)
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 })
  }
  const userId = (session.user as { id?: string }).id
  if (!userId) return NextResponse.json({ error: "no user id" }, { status: 500 })
  const body = (await req.json().catch(() => ({}))) as { view?: SavedView }
  if (!body.view) {
    return NextResponse.json({ error: "view payload required" }, { status: 400 })
  }
  // Validate the incoming view shape via the envelope schema.
  const validated = SavedViewsEnvelope.shape.views.element.safeParse(body.view)
  if (!validated.success) {
    return NextResponse.json(
      { error: "invalid view shape", issues: validated.error.issues },
      { status: 400 },
    )
  }
  const user = await prisma.fl_StaffUser.findUnique({
    where: { id: userId },
    select: { savedViewsJson: true },
  })
  const env = parseSavedViews(user?.savedViewsJson ?? null)
  const idx = env.views.findIndex((v) => v.id === validated.data.id)
  if (idx >= 0) env.views[idx] = validated.data
  else env.views.push(validated.data)
  await prisma.fl_StaffUser.update({
    where: { id: userId },
    data: { savedViewsJson: serializeSavedViews(env) },
  })
  return NextResponse.json({ ok: true })
}
