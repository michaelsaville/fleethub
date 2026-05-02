import { NextRequest, NextResponse } from "next/server"
import { requireSession } from "@/lib/authz"
import { cancelScriptRun } from "@/lib/script-commands"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  const { id } = await params
  try {
    const run = await cancelScriptRun(id, session.email)
    return NextResponse.json(run)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
