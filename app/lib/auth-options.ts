import type { NextAuthOptions } from "next-auth"
import AzureADProvider from "next-auth/providers/azure-ad"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

/**
 * Mirrors OpsHub auth — same PCC2K SSO Entra app, separate per-app
 * allowlist (Fl_StaffUser). FleetHub access can diverge from OpsHub
 * access intentionally; junior tech might have one without the other.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
    }),
  ],
  // SEC-11 — HIPAA-READY §3 locks a short idle timeout. Effective TTL
  // was the NextAuth 30-day default; an unattended workstation stayed
  // authed for weeks. maxAge caps the session; updateAge slides it on
  // activity so active operators aren't bounced mid-session. Tunable
  // via SESSION_MAX_AGE (seconds) without a code change; default 15min.
  session: {
    strategy: "jwt",
    maxAge: Number(process.env.SESSION_MAX_AGE ?? 900),
    updateAge: 300,
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase()
      if (!email) {
        await safeAudit({ action: "auth.signin", outcome: "error", detail: { reason: "no-email" } })
        return false
      }
      try {
        const allowed = await prisma.fl_StaffUser.findUnique({ where: { email } })
        const ok = !!(allowed && allowed.isActive)
        if (!ok) {
          await safeAudit({
            actorEmail: email,
            action: "auth.signin",
            outcome: "error",
            detail: { reason: allowed ? "inactive" : "not-allowlisted" },
          })
        }
        return ok
      } catch (e) {
        await safeAudit({
          actorEmail: email,
          action: "auth.signin",
          outcome: "error",
          detail: { reason: "lookup-failed", message: String(e) },
        })
        return false
      }
    },
    async jwt({ token, user }) {
      // Initial sign-in: `user` is present. Lock identity fields into
      // the token from the staff row.
      if (user?.email) {
        try {
          const staff = await prisma.fl_StaffUser.findUnique({
            where: { email: user.email.toLowerCase() },
          })
          if (staff) {
            token.id = staff.id
            token.role = staff.role
          }
        } catch (e) {
          console.error("FleetHub JWT signin error:", String(e))
        }
      }

      // Phase 11 WS-C.1 — re-read MFA gate inputs on EVERY JWT
      // refresh, not just initial sign-in. Without this, flipping
      // Fl_Tenant.mfaRequired=true on a live tenant fails to gate
      // any user with an active session; admins fix the policy
      // expecting enforcement and it silently doesn't apply. Two
      // indexed lookups per refresh — the partial index on
      // fl_tenants.mfaRequired keeps the cost low, and NextAuth's
      // refresh cadence (config'd elsewhere) means this fires far
      // less often than per-request.
      const userId = token.id as string | undefined
      if (userId) {
        try {
          const staff = await prisma.fl_StaffUser.findUnique({
            where: { id: userId },
            select: { totpEnabledAt: true, role: true },
          })
          if (staff) {
            ;(token as { totpEnabledAt?: string | null }).totpEnabledAt =
              staff.totpEnabledAt ? staff.totpEnabledAt.toISOString() : null
            // Role may have changed in the DB since sign-in; refresh
            // it too while we're here. (Cheap: same row read.)
            token.role = staff.role
          }
        } catch (e) {
          console.error("FleetHub JWT refresh staff lookup error:", String(e))
        }

        try {
          const anyTenantRequires = await prisma.fl_Tenant.findFirst({
            where: { mfaRequired: true },
            select: { id: true },
          })
          ;(token as { tenantMfaRequired?: boolean }).tenantMfaRequired =
            !!anyTenantRequires
        } catch (e) {
          console.error("FleetHub JWT refresh mfaRequired lookup error:", String(e))
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as { id?: string; role?: string }).id = token.id as string
        ;(session.user as { id?: string; role?: string }).role = token.role as string
      }
      return session
    },
  },
  events: {
    async signIn({ user }) {
      await safeAudit({
        actorEmail: user.email?.toLowerCase() ?? null,
        action: "auth.signin",
        outcome: "ok",
      })
    },
    async signOut({ token }) {
      const email = (token?.email as string | undefined)?.toLowerCase() ?? null
      await safeAudit({
        actorEmail: email,
        action: "auth.signout",
        outcome: "ok",
      })
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
}

async function safeAudit(args: Parameters<typeof writeAudit>[0]) {
  try {
    await writeAudit(args)
  } catch (e) {
    // Audit failure must never block auth; surface in logs only.
    console.error("FleetHub audit write failed:", String(e))
  }
}
