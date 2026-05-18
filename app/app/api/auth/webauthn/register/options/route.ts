import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { generateRegistrationOptions } from "@simplewebauthn/server"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import {
  getRpConfig,
  WEBAUTHN_CHALLENGE_COOKIE_PREFIX,
  WEBAUTHN_CHALLENGE_TTL_SECONDS,
} from "@/lib/webauthn"

// Phase 11 WS-C.4 — generate WebAuthn registration challenge. The
// authenticated user can add a new credential to their account.
//
// Stateless challenge: we set an HTTP-only cookie carrying the
// random challenge so the verify step can confirm freshness without
// a DB round-trip per attempt.

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
  const user = await prisma.fl_StaffUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  })
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 })
  }
  // Existing credentials to exclude — prevents the operator from
  // re-registering the same authenticator twice on the same account.
  const existing = await prisma.fl_WebAuthnCred.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transportsJson: true },
  })
  const { rpID, rpName } = getRpConfig()
  const options = await generateRegistrationOptions({
    rpID,
    rpName,
    userID: user.id,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    timeout: WEBAUTHN_CHALLENGE_TTL_SECONDS * 1000,
    attestationType: "none",
    authenticatorSelection: {
      // Resident-key not required; we accept both platform and roaming.
      userVerification: "preferred",
    },
    excludeCredentials: existing.map((c) => ({
      id: Buffer.from(c.credentialId),
      type: "public-key",
      transports: c.transportsJson
        ? (JSON.parse(c.transportsJson) as AuthenticatorTransport[])
        : undefined,
    })),
  })
  const cookieStore = await cookies()
  cookieStore.set(`${WEBAUTHN_CHALLENGE_COOKIE_PREFIX}register`, options.challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: WEBAUTHN_CHALLENGE_TTL_SECONDS,
    path: "/",
  })
  return NextResponse.json(options)
}

// AuthenticatorTransport is the simplewebauthn type. Importing
// directly from @simplewebauthn/types causes a circular module issue
// in some setups; the inline DOM type covers our usage.
type AuthenticatorTransport = "usb" | "nfc" | "ble" | "internal" | "hybrid"
