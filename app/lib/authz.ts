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
