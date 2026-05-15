import { NextResponse } from "next/server"
import { getSigningPublicKey } from "@/lib/reports/manifest-signing"

// Phase 5 step 13 — public key for evidence-zip manifest verification.
//
// Auditors fetch this endpoint, then verify any FleetHub manifest's
// Ed25519 signature against the returned public key. The route is
// intentionally unauthenticated — public keys are public, and forcing
// auth would defeat the auditor-friendly out-of-band verification path.
//
// When no signing key is configured, returns 404 (not 200 with an empty
// PEM) so client-side scripts can detect "this install doesn't sign"
// without parsing.

export const dynamic = "force-dynamic"

export async function GET() {
  const pub = getSigningPublicKey()
  if (!pub) {
    return NextResponse.json(
      { error: "no signing key configured" },
      { status: 404 },
    )
  }
  return new NextResponse(pub.publicKeyPem, {
    status: 200,
    headers: {
      "content-type": "application/x-pem-file; charset=utf-8",
      "x-fleethub-key-id": pub.keyId,
      "cache-control": "public, max-age=300",
    },
  })
}
