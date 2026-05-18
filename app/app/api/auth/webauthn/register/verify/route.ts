import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import type { RegistrationResponseJSON } from "@simplewebauthn/types"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import {
  getRpConfig,
  WEBAUTHN_CHALLENGE_COOKIE_PREFIX,
} from "@/lib/webauthn"

// Phase 11 WS-C.4 — verify a WebAuthn registration response. The
// client posts the attestation result; we verify against the
// challenge cookie set by /options.

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
    response?: RegistrationResponseJSON
    name?: string
  }
  if (!body.response) {
    return NextResponse.json({ error: "no attestation response" }, { status: 400 })
  }
  const credentialName = (body.name ?? "").trim() || "Unnamed authenticator"

  const cookieStore = await cookies()
  const challenge = cookieStore.get(`${WEBAUTHN_CHALLENGE_COOKIE_PREFIX}register`)?.value
  if (!challenge) {
    return NextResponse.json(
      { error: "no registration challenge in session; restart enrollment" },
      { status: 400 },
    )
  }
  const { rpID, origin } = getRpConfig()

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
  } catch (err) {
    await writeAudit({
      actorEmail: user.email,
      action: "webauthn.register.fail",
      outcome: "error",
      detail: { reason: err instanceof Error ? err.message : "verify-threw" },
    }).catch(() => {})
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "verify failed" },
      { status: 400 },
    )
  }

  if (!verification.verified || !verification.registrationInfo) {
    await writeAudit({
      actorEmail: user.email,
      action: "webauthn.register.fail",
      outcome: "error",
      detail: { reason: "verification rejected" },
    }).catch(() => {})
    return NextResponse.json({ error: "verification rejected" }, { status: 400 })
  }

  const { credentialID, credentialPublicKey, counter, aaguid } =
    verification.registrationInfo

  // Persist the credential. credentialID + publicKey are raw bytes;
  // Prisma will accept Uint8Array.
  const created = await prisma.fl_WebAuthnCred.create({
    data: {
      userId: user.id,
      credentialId: new Uint8Array(credentialID),
      publicKey: new Uint8Array(credentialPublicKey),
      signCount: BigInt(counter),
      transportsJson: body.response.response.transports
        ? JSON.stringify(body.response.response.transports)
        : null,
      name: credentialName,
      aaguid: aaguid ? new Uint8Array(Buffer.from(aaguid, "hex")) : null,
    },
  })

  // Clear the challenge cookie — it's single-use.
  cookieStore.delete(`${WEBAUTHN_CHALLENGE_COOKIE_PREFIX}register`)

  await writeAudit({
    actorEmail: user.email,
    action: "webauthn.register.ok",
    outcome: "ok",
    detail: { credId: created.id, name: credentialName },
  }).catch(() => {})

  return NextResponse.json({ ok: true, id: created.id, name: credentialName })
}
