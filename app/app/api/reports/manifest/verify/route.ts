import { NextRequest, NextResponse } from "next/server"
import { verifyManifestSignature, getSigningPublicKey } from "@/lib/reports/manifest-signing"

// Phase 5 step 13 — manifest verification endpoint.
//
// POST a manifest body (the JSON from manifest.json inside an evidence
// ZIP) and get back ok=true|false. Auditors who don't want to roll
// their own canonicalization + Ed25519 verifier can just hit this.
//
// The endpoint uses the inlined publicKeyPem from the manifest itself,
// which makes verification self-contained when the manifest is trusted.
// As a separate trust check, callers should compare that publicKeyPem
// against /api/well-known/fleethub-signing-key.

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON body" }, { status: 400 })
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, reason: "body must be a JSON object" }, { status: 400 })
  }
  const manifest = body as Record<string, unknown> & {
    signature?: { publicKeyPem?: string } | null
  }
  const publicKeyPem = manifest.signature?.publicKeyPem
  if (!publicKeyPem) {
    return NextResponse.json(
      { ok: false, reason: "manifest.signature.publicKeyPem missing" },
      { status: 400 },
    )
  }
  const result = verifyManifestSignature(
    manifest as Parameters<typeof verifyManifestSignature>[0],
    publicKeyPem,
  )
  // Cross-check the inlined public key against the live well-known key
  // when one is configured. Mismatch = manifest claims a signature from
  // a different key than this server's current key. Don't fail the
  // verify response in that case (the manifest may be from an older
  // rotation), just surface the discrepancy.
  const live = getSigningPublicKey()
  const livePublicKeyMatches = live ? live.publicKeyPem.trim() === publicKeyPem.trim() : null
  return NextResponse.json({
    ok: result.ok,
    reason: result.ok ? null : result.reason,
    keyId: manifest.signature && typeof manifest.signature === "object"
      ? (manifest.signature as { keyId?: string }).keyId ?? null
      : null,
    livePublicKeyMatches,
  })
}
