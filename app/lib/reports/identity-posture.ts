import "server-only"
import { prisma } from "@/lib/prisma"
import { fetchScoutIdentityAudit, type ScoutIdentityResults } from "@/lib/scout-client"

// PHASE-5-DESIGN §3.4: Identity Posture (Scout integration).
//
// Pulls the latest IdentityAuditResults from Scout for a tenant whose
// Fl_Tenant.scoutTenantId is set. The report mirrors Scout's own Identity
// page but is rendered as a FleetHub PDF (audience-gated like the others).
//
// Empty states:
//   - tenant.scoutTenantId is null  → "Not bound to Scout" page
//   - Scout returned 404            → "Prospect not found in Scout"
//   - Scout returned no results yet → "Audit not yet run in Scout"
//   - SCOUT_BFF_SECRET missing      → "Cross-app pull not configured"

export type IdentityPostureStatus =
  | "ok"
  | "not-bound"
  | "not-run"
  | "fetch-failed"

export interface IdentityPostureData {
  tenantName: string
  audience: "tech" | "client" | "auditor"
  asOf: Date

  status: IdentityPostureStatus
  /** When status !== "ok", a human-readable line for the empty-state page. */
  statusMessage: string

  /** Populated only when status === "ok". */
  prospect: {
    id: string
    name: string
    slug: string
  } | null
  runAt: Date | null
  results: ScoutIdentityResults | null
}

export async function buildIdentityPostureReport(input: {
  tenantName: string
  audience?: "tech" | "client" | "auditor"
  asOf?: Date
}): Promise<IdentityPostureData> {
  const audience = input.audience ?? "client"
  const asOf = input.asOf ?? new Date()

  const base: Pick<IdentityPostureData, "tenantName" | "audience" | "asOf" | "prospect" | "runAt" | "results"> = {
    tenantName: input.tenantName,
    audience,
    asOf,
    prospect: null,
    runAt: null,
    results: null,
  }

  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: input.tenantName },
    select: { scoutTenantId: true },
  })

  if (!tenant?.scoutTenantId) {
    return {
      ...base,
      status: "not-bound",
      statusMessage:
        "This tenant is not bound to a Scout audit. Run an Identity audit in Scout for this client and set Fl_Tenant.scoutTenantId to the Scout prospect id.",
    }
  }

  const payload = await fetchScoutIdentityAudit(tenant.scoutTenantId)
  if (!payload) {
    return {
      ...base,
      status: "fetch-failed",
      statusMessage:
        "Could not reach the Scout cross-app endpoint. Verify SCOUT_BFF_SECRET + SCOUT_BASE_URL on FleetHub and that pcc-scout-api is reachable on the dochub_default network.",
    }
  }

  if (!payload.results) {
    return {
      ...base,
      status: "not-run",
      statusMessage: `Scout has no Identity audit results for "${payload.prospectName}" yet. Open the prospect in Scout, complete admin-consent if needed, and run the audit.`,
      prospect: {
        id: payload.prospectId,
        name: payload.prospectName,
        slug: payload.prospectSlug,
      },
      runAt: payload.runAt ? new Date(payload.runAt) : null,
    }
  }

  return {
    tenantName: input.tenantName,
    audience,
    asOf,
    status: "ok",
    statusMessage: "",
    prospect: {
      id: payload.prospectId,
      name: payload.prospectName,
      slug: payload.prospectSlug,
    },
    runAt: payload.runAt ? new Date(payload.runAt) : null,
    results: payload.results,
  }
}
