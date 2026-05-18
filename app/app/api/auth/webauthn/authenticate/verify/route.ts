import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { verifyAuthenticationResponse } from "@simplewebauthn/server"
import type { AuthenticationResponseJSON } from "@simplewebauthn/types"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { mintStepUpToken } from "@/lib/crypto-key"
import {
  getRpConfig,
  WEBAUTHN_CHALLENGE_COOKIE_PREFIX,
} from "@/lib/webauthn"

// Phase 11 WS-C.4 — verify WebAuthn assertion and mint a step-up
// token. The token (HMAC-signed, 5-min TTL, single-use) is what
// disclose + approve verbs require in their `X-FleetHub-StepUp`
// header.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 })
  }
  const userId = (session.user as { id?: string }).id
  if (!userId) {
    return NextResponse.json({ error: "session has no user id" }, { status: 500 })
  }
  const user = await prisma.fl_StaffUser.findUnique({ where: { id: userId } })
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    response?: AuthenticationResponseJSON
  }
  if (!body.response) {
    return NextResponse.json({ error: "no authentication response" }, { status: 400 })
  }

  const cookieStore = await cookies()
  const challenge = cookieStore.get(
    `${WEBAUTHN_CHALLENGE_COOKIE_PREFIX}authenticate`,
  )?.value
  if (!challenge) {
    return NextResponse.json(
      { error: "no authentication challenge in session; restart" },
      { status: 400 },
    )
  }

  // Find the credential by id sent by the client.
  const credIdBytes = Buffer.from(body.response.id, "base64url")
  const cred = await prisma.fl_WebAuthnCred.findUnique({
    where: { credentialId: new Uint8Array(credIdBytes) },
  })
  if (!cred || cred.userId !== user.id) {
    await writeAudit({
      actorEmail: user.email,
      action: "webauthn.authenticate.fail",
      outcome: "error",
      detail: { reason: "unknown credential or wrong user" },
    }).catch(() => {})
    return NextResponse.json({ error: "credential not recognized" }, { status: 401 })
  }

  const { rpID, origin } = getRpConfig()
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: Buffer.from(cred.credentialId),
        credentialPublicKey: Buffer.from(cred.publicKey),
        counter: Number(cred.signCount),
      },
      requireUserVerification: false,
    })
  } catch (err) {
    await writeAudit({
      actorEmail: user.email,
      action: "webauthn.authenticate.fail",
      outcome: "error",
      detail: { reason: err instanceof Error ? err.message : "verify-threw" },
    }).catch(() => {})
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "verify failed" },
      { status: 401 },
    )
  }
  if (!verification.verified) {
    return NextResponse.json({ error: "verification rejected" }, { status: 401 })
  }

  // Update sign count + last-used. Counter regression is a clone
  // signal per the WebAuthn spec; simplewebauthn raises if so, which
  // we surface as a 401 by the catch above.
  await prisma.fl_WebAuthnCred.update({
    where: { id: cred.id },
    data: {
      signCount: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  })

  // Clear the challenge cookie.
  cookieStore.delete(`${WEBAUTHN_CHALLENGE_COOKIE_PREFIX}authenticate`)

  // Mint step-up token. 5-min TTL handled by mintStepUpToken default.
  const stepUpToken = await mintStepUpToken(user.id)

  await writeAudit({
    actorEmail: user.email,
    action: "webauthn.authenticate.ok",
    outcome: "ok",
    detail: { credId: cred.id },
  }).catch(() => {})

  return NextResponse.json({ ok: true, stepUpToken })
}
