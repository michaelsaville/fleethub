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
