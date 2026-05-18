import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import SecurityClient from "./SecurityClient"

// Phase 11 WS-C.6 — self-service security center.
// Outside (protected) so users on forced-enroll tenants can reach
// it WITHOUT first clearing MFA (chicken-and-egg). Middleware
// excludes /account/security from the MFA gate.

export const dynamic = "force-dynamic"

export default async function AccountSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ forced?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect("/login")
  }
  const userId = (session.user as { id?: string }).id
  if (!userId) {
    redirect("/login")
  }
  const [user, webauthnCreds, sp] = await Promise.all([
    prisma.fl_StaffUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        totpEnabledAt: true,
        recoveryCodesJson: true,
      },
    }),
    prisma.fl_WebAuthnCred.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        transportsJson: true,
      },
    }),
    searchParams,
  ])
  if (!user) {
    redirect("/login")
  }
  const forced = sp.forced === "1"
  const remainingRecoveryCodes = user.recoveryCodesJson
    ? (JSON.parse(user.recoveryCodesJson) as string[]).length
    : 0

  return (
    <AppShell>
      <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={TYPOGRAPHY.H1}>Security</h1>
        <div style={{ ...TYPOGRAPHY.HINT }}>
          Signed in as {user.email}
        </div>
        {forced && !user.totpEnabledAt && (
          <InlineAlert tone="warn">
            Your tenant requires multi-factor authentication. Please
            enroll a code generator to continue.
          </InlineAlert>
        )}
        <Card>
          <CardHeader title="Authenticator app (TOTP)" />
          <SecurityClient
            staffId={user.id}
            email={user.email}
            totpEnabledAt={user.totpEnabledAt ? user.totpEnabledAt.toISOString() : null}
            remainingRecoveryCodes={remainingRecoveryCodes}
            webauthnCreds={webauthnCreds.map((c) => ({
              id: c.id,
              name: c.name,
              createdAt: c.createdAt.toISOString(),
              lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
              transports: c.transportsJson
                ? (JSON.parse(c.transportsJson) as string[])
                : [],
            }))}
          />
        </Card>
      </div>
    </AppShell>
  )
}
