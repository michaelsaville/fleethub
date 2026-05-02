import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { approvePackage } from "@/lib/packages"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin()
  const { id } = await params
  try {
    const pkg = await approvePackage(id, session.email)
    return NextResponse.json(pkg)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
