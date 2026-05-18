import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { generateAuthenticationOptions } from "@simplewebauthn/server"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import {
  getRpConfig,
  WEBAUTHN_CHALLENGE_COOKIE_PREFIX,
  WEBAUTHN_CHALLENGE_TTL_SECONDS,
} from "@/lib/webauthn"

// Phase 11 WS-C.4 — generate WebAuthn authentication challenge.
// Used by step-up flow (lib/step-up.ts via /api/auth/mfa-stepup) to
// gate disclose + approve verbs with a fresh hardware attestation.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 })
  }
  const userId = (session.user as { id?: string }).id
  if (!userId) {
    return NextResponse.json({ error: "session has no user id" }, { status: 500 })
  }
  const creds = await prisma.fl_WebAuthnCred.findMany({
    where: { userId },
    select: { credentialId: true, transportsJson: true },
  })
  if (creds.length === 0) {
    return NextResponse.json(
      { error: "no WebAuthn credentials enrolled for this user" },
      { status: 404 },
    )
  }
  const { rpID } = getRpConfig()
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: WEBAUTHN_CHALLENGE_TTL_SECONDS * 1000,
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({
      id: Buffer.from(c.credentialId),
      type: "public-key",
      transports: c.transportsJson
        ? (JSON.parse(c.transportsJson) as AuthenticatorTransport[])
        : undefined,
    })),
  })
  const cookieStore = await cookies()
  cookieStore.set(`${WEBAUTHN_CHALLENGE_COOKIE_PREFIX}authenticate`, options.challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: WEBAUTHN_CHALLENGE_TTL_SECONDS,
    path: "/",
  })
  return NextResponse.json(options)
}

type AuthenticatorTransport = "usb" | "nfc" | "ble" | "internal" | "hybrid"
