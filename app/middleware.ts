import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

// Phase 10 WS-E — MFA login gate.
//
// Runs ahead of every (protected) request + every /api/admin/*
// request. If the user has totpEnabledAt set (or the tenant has
// mfaRequired) AND no valid fleethub_mfa_cleared cookie, redirect
// the browser flow to /mfa-challenge and refuse JSON API calls
// with 401.
//
// The "is the user enrolled / does the tenant require MFA" check
// requires a DB hit per request. To avoid that, we encode the
// enrollment + mfa-required bits into the JWT during the
// next-auth jwt callback (see lib/auth-options.ts) and read them
// from the token here. Middleware never touches the DB.
//
// The mfaCleared cookie is signed via lib/mfa-cookie.ts (HMAC over
// NEXTAUTH_SECRET) — middleware can't verify it without exposing
// the secret to Edge runtime. We move both the cookie verify and
// this middleware to the Node runtime via `runtime = 'nodejs'`
// at module level — see config below.

export const config = {
  // Run only on protected pages + admin API. Everything else
  // (auth callbacks, public assets, /mfa-challenge itself) skips.
  matcher: [
    /*
     * Skip:
     * - /_next/...
     * - /api/auth/...   (next-auth handlers, including webauthn enroll/verify)
     * - /api/health
     * - /api/inbound/   (token-only HMAC, no session)
     * - /api/agent-ingest (HMAC bearer)
     * - /api/cron/...   (HMAC bearer)
     * - /api/bff/...    (HMAC bearer)
     * - /mfa-challenge  (the gate's destination)
     * - /login
     * - /api/auth/mfa-verify (the gate's submit target)
     * - /account/security (Phase 11 WS-C.6 — forced-enroll target;
     *   must be reachable without an MFA cookie so users CAN enroll)
     * Apply to everything else.
     */
    "/((?!_next/|api/auth|api/health|api/inbound|api/agent-ingest|api/cron|api/bff|mfa-challenge|login|account/security|favicon\\.ico).*)",
  ],
}

export async function middleware(req: NextRequest) {
  const token = await getToken({ req })
  if (!token) {
    // Not signed in. Page routes redirect to /login via NextAuth's
    // own pages.signIn config; API routes already return 401.
    return NextResponse.next()
  }

  const totpEnabled = (token as { totpEnabledAt?: string | null }).totpEnabledAt != null
  const tenantMfaRequired = (token as { tenantMfaRequired?: boolean }).tenantMfaRequired === true

  if (!totpEnabled && !tenantMfaRequired) {
    // User hasn't opted into TOTP and their tenant doesn't require
    // it. Pass through.
    return NextResponse.next()
  }

  // Has the operator already cleared MFA in this browser?
  const cookie = req.cookies.get("fleethub_mfa_cleared")?.value
  // Lazy import to keep middleware bundle small. Edge runtime tolerates
  // this for the Node-runtime matcher.
  const { verifyMfaCookieValue } = await import("@/lib/mfa-cookie")
  const verified = await verifyMfaCookieValue(cookie)
  if (verified.ok && verified.userId === (token as { id?: string }).id) {
    return NextResponse.next()
  }

  // Tenant enforces MFA but user hasn't enrolled — force enrollment.
  // Phase 11 WS-C.6: redirect to self-service page, NOT the admin
  // /setup/staff page (which is admin-only and creates a chicken-
  // and-egg for non-admin users on forced-enroll tenants).
  if (tenantMfaRequired && !totpEnabled) {
    const url = new URL("/account/security", req.url)
    url.searchParams.set("forced", "1")
    return NextResponse.redirect(url)
  }

  // Otherwise show the challenge.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "mfa-required" }, { status: 401 })
  }
  const url = new URL("/mfa-challenge", req.url)
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search)
  return NextResponse.redirect(url)
}
