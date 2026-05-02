import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { simulateScriptResult } from "@/lib/script-commands"

// MOCK-MODE ONLY: simulate an agent response on a queued run. Becomes
// dead code once Phase 2 step 4 ships real agent dispatch. ADMIN-only
// so techs can't accidentally fake-complete a run a junior is watching.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    outcome?: "ok" | "error" | "timeout"
    output?: string
    exitCode?: number
  }
  const outcome = body.outcome ?? "ok"
  const output =
    body.output ??
    (outcome === "ok"
      ? "Script executed.\nNo issues found.\n"
      : outcome === "error"
        ? "Error: command not found\n"
        : "Process timed out after 300s\n")
  const exitCode = body.exitCode ?? (outcome === "ok" ? 0 : 1)
  try {
    const run = await simulateScriptResult(id, outcome, output, exitCode, session.email)
    return NextResponse.json(run)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
