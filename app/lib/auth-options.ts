import type { NextAuthOptions } from "next-auth"
import AzureADProvider from "next-auth/providers/azure-ad"
import { prisma } from "@/lib/prisma"

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
      if (!user.email) return false
      try {
        const allowed = await prisma.fl_StaffUser.findUnique({
          where: { email: user.email.toLowerCase() },
        })
        return !!(allowed && allowed.isActive)
      } catch {
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
  pages: {
    signIn: "/login",
    error: "/login",
  },
}
