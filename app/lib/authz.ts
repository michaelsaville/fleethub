import "server-only"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"

export type StaffRole = "ADMIN" | "TECH" | "VIEWER"

export interface SessionContext {
  email: string
  role: StaffRole
  id: string | null
}

/**
 * Resolve the current session for a server component or server action.
 * Returns null when nobody is signed in. Use `requireSession` for paths
 * that must be authenticated — it redirects to /login on miss.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; role?: string; email?: string | null } | undefined
  const email = user?.email?.toLowerCase()
  if (!email) return null
  return {
    email,
    role: (user?.role as StaffRole) ?? "VIEWER",
    id: user?.id ?? null,
  }
}

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext()
  if (!ctx) redirect("/login")
  return ctx
}

/**
 * Server actions that mutate privileged state should call this. Throws
 * if the caller isn't ADMIN — server actions surface the throw as a
 * client-visible error, which is the right UX for "you can't do that"
 * instead of silent no-ops.
 */
export async function requireAdmin(): Promise<SessionContext> {
  const ctx = await requireSession()
  if (ctx.role !== "ADMIN") {
    throw new Error("Forbidden: ADMIN role required")
  }
  return ctx
}

// Role rank for "at least" checks. ADMIN ⊇ TECH ⊇ VIEWER.
const ROLE_RANK: Record<StaffRole, number> = { VIEWER: 0, TECH: 1, ADMIN: 2 }

/**
 * SEC-2 — gate code-executing routes (script run, patch deploy,
 * deployments) so a VIEWER can't POST a fleet-wide command just
 * because the UI hides the button. Enforces "at least `min`". Throws
 * Forbidden on miss (right UX for server actions); API routes that
 * want a 403 instead of a throw should use `requireRoleResponse`.
 */
export async function requireRole(min: StaffRole): Promise<SessionContext> {
  const ctx = await requireSession()
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    throw new Error(`Forbidden: ${min} role or higher required`)
  }
  return ctx
}

/** Convenience: read-only VIEWER excluded, TECH+ allowed. */
export async function requireTech(): Promise<SessionContext> {
  return requireRole("TECH")
}

/**
 * API-route variant: resolves the session and returns either the
 * context (ok) or a ready-to-return 401/403 Response, so route
 * handlers can do:
 *   const gate = await requireRoleResponse("TECH")
 *   if ("response" in gate) return gate.response
 *   const { ctx } = gate
 */
export async function requireRoleResponse(
  min: StaffRole,
): Promise<{ ctx: SessionContext } | { response: Response }> {
  const ctx = await getSessionContext()
  if (!ctx) {
    return {
      response: new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    }
  }
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    return {
      response: new Response(
        JSON.stringify({ error: `forbidden: ${min} role or higher required` }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    }
  }
  return { ctx }
}
