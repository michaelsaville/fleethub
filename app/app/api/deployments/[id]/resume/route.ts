import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { resumeDeployment } from "@/lib/deployments"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params
  try {
    return NextResponse.json(await resumeDeployment(id, session.email))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
