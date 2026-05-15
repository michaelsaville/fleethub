import "server-only"
import crypto from "node:crypto"

// Phase 5 step 13 — Ed25519 manifest signing for evidence-zip manifests.
//
// Activation: drop a PEM-encoded Ed25519 private key into env var
// FLEETHUB_SIGNING_PRIVATE_KEY_PEM. Newlines may be encoded as literal
// \n (env-friendly) or actual newlines. When unset, signManifest()
// returns null and the manifest carries signature=null — the v1 step-11
// behavior, preserved for backward compatibility.
//
// Server-wide single key for v1. Per-tenant compliance keys + rotation
// arrive in step 11.5 once the key-management UI lands.
//
// Generate a keypair with:
//   openssl genpkey -algorithm ed25519 -out fleethub-signing.pem
//   openssl pkey -in fleethub-signing.pem -pubout -out fleethub-signing.pub.pem

const ENV_VAR = "FLEETHUB_SIGNING_PRIVATE_KEY_PEM"

export interface ManifestSignature {
  alg: "ed25519"
  /** Short fingerprint over the public key SPKI DER (first 16 hex of sha256). */
  keyId: string
  /** Base64-encoded raw signature bytes (64 bytes for Ed25519). */
  sig: string
  /** Identifies how the signed bytes were derived from the manifest object. */
  canonicalAlg: "json-sorted-keys-utf8-no-signature"
  /** Public key PEM published alongside the manifest so auditors can verify
   *  without contacting the server. The canonical source is the
   *  /api/well-known/fleethub-signing-key endpoint, but inlining lets the
   *  evidence ZIP be self-contained. */
  publicKeyPem: string
}

interface KeyMaterial {
  privateKey: crypto.KeyObject
  publicKey: crypto.KeyObject
  publicKeyPem: string
  keyId: string
}

let cached: KeyMaterial | null | undefined

/**
 * Load + cache the signing key material. Returns null when env var is
 * unset or invalid (logs once, then suppressed). Manifest signing is
 * intentionally optional in v1 so unsigned and signed deployments can
 * coexist during the rollout window.
 */
function loadKeyMaterial(): KeyMaterial | null {
  if (cached !== undefined) return cached
  const raw = process.env[ENV_VAR]
  if (!raw || !raw.trim()) {
    cached = null
    return null
  }
  const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
  let privateKey: crypto.KeyObject
  try {
    privateKey = crypto.createPrivateKey({ key: pem, format: "pem" })
  } catch (err) {
    console.warn(`[manifest-signing] ${ENV_VAR} is set but failed to parse:`, err)
    cached = null
    return null
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    console.warn(
      `[manifest-signing] ${ENV_VAR} key type is ${privateKey.asymmetricKeyType}, expected ed25519`,
    )
    cached = null
    return null
  }
  const publicKey = crypto.createPublicKey(privateKey)
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString()
  const spkiDer = publicKey.export({ format: "der", type: "spki" })
  const keyId = crypto.createHash("sha256").update(spkiDer).digest("hex").slice(0, 16)
  cached = { privateKey, publicKey, publicKeyPem, keyId }
  return cached
}

/** Public-key surface for the well-known route + audit-side verification. */
export function getSigningPublicKey(): { publicKeyPem: string; keyId: string } | null {
  const km = loadKeyMaterial()
  if (!km) return null
  return { publicKeyPem: km.publicKeyPem, keyId: km.keyId }
}

/** Force-reload on next call — used by tests after rotating env. */
export function _resetSigningKeyCacheForTests() {
  cached = undefined
}

/**
 * Canonicalize a manifest for signing. Strips any pre-existing
 * `signature` field, sorts object keys recursively, and serializes
 * with no whitespace. Arrays preserve order.
 */
export function canonicalizeManifestForSigning(manifest: unknown): string {
  return JSON.stringify(stripSignatureAndSort(manifest))
}

function stripSignatureAndSort(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(stripSignatureAndSort)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const keys = Object.keys(obj).filter((k) => k !== "signature").sort()
  for (const k of keys) out[k] = stripSignatureAndSort(obj[k])
  return out
}

/**
 * Sign a manifest object. Returns null when the signing key is not
 * configured — caller should leave `signature: null` on the manifest.
 *
 * The manifest passed in MUST already be the final structural object
 * (per-file hashes, audit-chain tip hash, etc., all populated). This
 * function strips any existing `signature` field before signing so the
 * canonical form is reproducible.
 */
export function signManifest(manifest: unknown): ManifestSignature | null {
  const km = loadKeyMaterial()
  if (!km) return null
  const canonical = canonicalizeManifestForSigning(manifest)
  const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), km.privateKey)
  return {
    alg: "ed25519",
    keyId: km.keyId,
    sig: sig.toString("base64"),
    canonicalAlg: "json-sorted-keys-utf8-no-signature",
    publicKeyPem: km.publicKeyPem,
  }
}

/**
 * Verify a manifest signature. Used by the integration smoke and the
 * /api/reports/manifest/verify endpoint. The public key passed in
 * should be the one published at /api/well-known/fleethub-signing-key
 * — auditors who trust that endpoint can re-verify offline.
 */
export function verifyManifestSignature(
  manifestWithSignature: { signature?: ManifestSignature | null } & Record<string, unknown>,
  publicKeyPem: string,
): { ok: true } | { ok: false; reason: string } {
  const sig = manifestWithSignature.signature
  if (!sig) return { ok: false, reason: "manifest has no signature" }
  if (sig.alg !== "ed25519") return { ok: false, reason: `unsupported alg: ${sig.alg}` }
  if (sig.canonicalAlg !== "json-sorted-keys-utf8-no-signature") {
    return { ok: false, reason: `unsupported canonicalAlg: ${sig.canonicalAlg}` }
  }
  let publicKey: crypto.KeyObject
  try {
    publicKey = crypto.createPublicKey({ key: publicKeyPem, format: "pem" })
  } catch (err) {
    return { ok: false, reason: `public key parse failed: ${(err as Error).message}` }
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    return { ok: false, reason: `public key type is ${publicKey.asymmetricKeyType}, expected ed25519` }
  }
  const canonical = canonicalizeManifestForSigning(manifestWithSignature)
  const ok = crypto.verify(null, Buffer.from(canonical, "utf8"), publicKey, Buffer.from(sig.sig, "base64"))
  return ok ? { ok: true } : { ok: false, reason: "signature does not verify" }
}
