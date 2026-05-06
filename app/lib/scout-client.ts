import "server-only"

// Cross-app client for the Scout Identity Posture BFF.
// Mirrors the IdentityAuditResults shape exported from
// pcc-scout-api/lib/identity-audit.ts; types here are the contract surface
// FleetHub depends on. Keep in sync with Scout when fields are added.
//
// Activation: SCOUT_BFF_SECRET (matches Scout-side .env.local) and
// SCOUT_BASE_URL (defaults to http://pcc-scout-api:3000 — the Docker
// container hostname on dochub_default).

const DEFAULT_BASE_URL = "http://pcc-scout-api:3000"
const APP_ID = "fleethub"
const TIMEOUT_MS = 15_000

export interface ScoutUserBrief {
  id: string
  upn: string
  displayName: string | null
  enabled: boolean
  userType: string | null
  lastSignIn: string | null
  daysSinceSignIn: number | null
  licenseCount: number
}

export interface ScoutIdentityResults {
  tenant: {
    id: string
    displayName: string | null
    primaryDomain: string | null
    verifiedDomains: { name: string; isInitial: boolean; isDefault: boolean }[]
  }
  runAt: string
  errors: { area: string; reason: string }[]
  users: {
    total: number
    members: number
    guests: number
    enabled: number
    disabled: number
    disabledLicensed: number
    licensedTotal: number
    staleWarn: number
    staleCrit: number
    neverSignedIn: number
    staleSample: ScoutUserBrief[]
    disabledLicensedSample: ScoutUserBrief[]
  }
  admins: {
    available: boolean
    globalAdmins: ScoutUserBrief[]
    count: number
    inBestPracticeBand: boolean
  }
  mfa: {
    available: boolean
    totalAssessed: number
    membersAssessed: number
    membersRegistered: number
    membersCapable: number
    membersRegisteredPct: number
    adminsAssessed: number
    adminsRegistered: number
    adminsRegisteredPct: number
    adminsWithoutMfa: ScoutUserBrief[]
  }
  secureScore: {
    available: boolean
    reason?: string
    current: number | null
    max: number | null
    pct: number | null
    createdDateTime: string | null
    lowestControls: {
      name: string
      category: string
      description: string
      score: number
      pct: number | null
    }[]
  }
  conditionalAccess: {
    available: boolean
    reason?: string
    total: number
    enabled: number
    reportOnly: number
    disabled: number
    requireMfaForAdmins: boolean
    requireMfaAllUsers: boolean
    blockLegacyAuth: boolean
    policies: {
      id: string
      displayName: string
      state: string
      requiresMfa: boolean
      blocksLegacyAuth: boolean
    }[]
  }
  summary: {
    headlineIssues: string[]
  }
}

export interface ScoutIdentityPayload {
  prospectId: string
  prospectName: string
  prospectSlug: string
  runAt: string | null
  results: ScoutIdentityResults | null
}

/**
 * Fetch a Prospect's most recent IdentityAuditResults from Scout.
 * Returns null when env is missing or the call fails so the caller can
 * render a "Scout not bound / not configured" empty state without
 * surfacing a 5xx to the operator.
 */
export async function fetchScoutIdentityAudit(
  prospectId: string,
): Promise<ScoutIdentityPayload | null> {
  const baseUrl = process.env.SCOUT_BASE_URL || DEFAULT_BASE_URL
  const token = process.env.SCOUT_BFF_SECRET
  if (!token) {
    console.log("[scout-client] SCOUT_BFF_SECRET not set; skipping fetch")
    return null
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/api/bff/identity-audit/${encodeURIComponent(prospectId)}`
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${token}`,
        "x-app": APP_ID,
      },
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => "")
      console.error(`[scout-client] BFF ${res.status} for ${prospectId}: ${detail.slice(0, 200)}`)
      return null
    }
    return (await res.json()) as ScoutIdentityPayload
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[scout-client] fetch failed: ${msg}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}
