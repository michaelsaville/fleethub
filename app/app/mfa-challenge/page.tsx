import { Suspense } from "react"
import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import { Card } from "@/components/ui/Card"
import MfaChallengeForm from "./MfaChallengeForm"

// Phase 10 WS-E — public TOTP challenge page. Sits OUTSIDE the
// (protected) group so middleware doesn't gate it. After
// successful verify, /api/auth/mfa-verify sets the
// fleethub_mfa_cleared cookie and redirects back to ?next=.

export const dynamic = "force-dynamic"

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect("/login")
  }
  const sp = await searchParams
  const next = sp.next && sp.next.startsWith("/") ? sp.next : "/"

  // Lookup the user's enrollment so we can show the "use recovery
  // code" link only when relevant.
  const userId = (session.user as { id?: string }).id ?? null
  const staff = userId
    ? await prisma.fl_StaffUser.findUnique({
        where: { id: userId },
        select: { totpEnabledAt: true, recoveryCodesJson: true },
      })
    : null

  if (!staff?.totpEnabledAt) {
    // User isn't actually enrolled — they shouldn't have been gated
    // here. Send them to the enrollment surface; middleware will
    // re-evaluate on next request.
    redirect(`/setup/staff/${userId ?? ""}?tab=mfa&forced=1`)
  }

  const hasRecoveryCodes = !!staff.recoveryCodesJson

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-background-primary)",
        padding: 20,
      }}
    >
      <Card style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <header>
            <h1 style={TYPOGRAPHY.H1}>Two-factor verification</h1>
            <p style={{ ...TYPOGRAPHY.BODY_MUTED, marginTop: 6 }}>
              Enter the 6-digit code from your authenticator app.
            </p>
          </header>
          <Suspense fallback={null}>
            <MfaChallengeForm next={next} hasRecoveryCodes={hasRecoveryCodes} />
          </Suspense>
        </div>
      </Card>
    </div>
  )
}
