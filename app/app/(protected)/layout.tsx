import { requireSession } from "@/lib/authz"

/**
 * Server-side gate for every page in the FleetHub app surface. Anything
 * that should NOT require sign-in (login page, NextAuth callbacks,
 * /api/health) lives outside this route group, at the app root.
 *
 * AppShell still does its own client-side useSession check on top of
 * this — defense in depth, plus AppShell provides the loading-spinner
 * UX when the JWT is still hydrating client-side.
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  return <>{children}</>
}
