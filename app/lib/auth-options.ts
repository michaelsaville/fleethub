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
  session: { strategy: "jwt" },
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
          console.error("FleetHub JWT error:", String(e))
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
