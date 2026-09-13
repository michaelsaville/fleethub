import "server-only"
import { prisma } from "@/lib/prisma"

/**
 * Cross-schema lookup into TicketHub. FleetHub and TicketHub share a
 * Postgres instance but live in separate Prisma schemas, so this uses
 * $queryRaw rather than a Prisma model. Lookup is case-insensitive on
 * `name`; the returned `name` is TH's canonical casing — callers
 * should use that value (not the operator's input) when persisting,
 * so FleetHub names stay byte-equal to TH_Client.name.
 */
export async function findTickethubClientByName(
  name: string,
): Promise<{ name: string } | null> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM tickethub.th_clients
    WHERE lower(name) = lower(${name})
    LIMIT 1
  `
  return rows[0] ?? null
}

export interface TickethubClientCandidate {
  name: string
  shortCode: string | null
  city: string | null
  clientType: string
  contacts: number
  /** Already has an Fl_Tenant row (so the picker can grey it out). */
  isTenant: boolean
}

/** Active TicketHub clients for the "new client" picker. Shared DB —
 *  there is no reason to make an operator retype a name that already
 *  exists 1 schema over. */
export async function listTickethubClientCandidates(): Promise<TickethubClientCandidate[]> {
  return prisma.$queryRaw<TickethubClientCandidate[]>`
    SELECT c.name,
           max(c."shortCode") AS "shortCode",
           max(c."billingCity") AS city,
           max(c."clientType"::text) AS "clientType",
           sum((SELECT count(*)::int FROM tickethub.th_contacts k
                 WHERE k."clientId" = c.id AND k."isActive"))::int AS contacts,
           EXISTS (SELECT 1 FROM fleethub.fl_tenants t WHERE t.name = c.name) AS "isTenant"
      FROM tickethub.th_clients c
     WHERE c."isActive"
     -- TicketHub has a few duplicate names (Novum Designs, Chillmers, …);
     -- FleetHub keys on name, so collapse them to one row.
     GROUP BY c.name
     ORDER BY c.name
  `
}
