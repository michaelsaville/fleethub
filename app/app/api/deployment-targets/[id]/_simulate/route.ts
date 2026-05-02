import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { simulateAgentResponse } from "@/lib/deployments"

// MOCK-MODE ONLY: simulate the agent reporting back on a deployment
// target. Becomes dead code when real agent dispatch lands. ADMIN-only.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    outcome?: "succeed" | "no-op" | "fail-disk" | "fail-policy" | "reboot-deferred"
  }
  const outcome = body.outcome ?? "succeed"
  try {
    await simulateAgentResponse(id, outcome, session.email)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
