import { NextRequest, NextResponse } from "next/server"
import { openRemoteSession } from "@/app/(protected)/remote-sessions/actions"

// Phase 7 Workstream C step 3 — thin POST wrapper around the
// openRemoteSession server action so the client-side launcher
// modal can fetch + receive the deep link as JSON. The action
// itself owns all the authz + audit + Pro/free branching.

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    deviceId?: string
    justification?: string
  }
  const form = new FormData()
  form.append("deviceId", body.deviceId ?? "")
  form.append("justification", body.justification ?? "")
  try {
    const result = await openRemoteSession(form)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    // Authz failures from requireSession() throw a redirect that
    // bubbles as a string mentioning "redirect" — translate to 401
    // so the client modal shows a sensible error.
    const isAuth = /redirect|unauthorized/i.test(message)
    return NextResponse.json({ error: message }, { status: isAuth ? 401 : 400 })
  }
}
