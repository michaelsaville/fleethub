import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withCronAuth } from "@/lib/with-cron-auth"

// Phase 9 WS-C §5.3 — PSA endpoint-count sync.
//
// For each tenant where Fl_Tenant.psaSyncEnabled is true, count
// active endpoints and write the count into TH_ContractRecurringItem
// rows tagged "syncSource = fleethub-endpoint-count". Cross-schema
// raw query — TH side carries the additive syncSource column added
// alongside this commit.
//
// Cadence: daily at 03:00 UTC (host crontab). Idempotent — re-runs
// are no-ops if counts haven't changed.

export const dynamic = "force-dynamic"
export const maxDuration = 120

interface SyncRow {
  contractItemId: string
  after: number
  contractName: string
  clientName: string
}

const handler = withCronAuth<NextRequest>(async () => {
  const startedAt = Date.now()
  const tenants = await prisma.fl_Tenant.findMany({
    where: { psaSyncEnabled: true },
    select: { name: true },
  })
  const synced: SyncRow[] = []
  const skipped: Array<{ tenant: string; reason: string }> = []

  for (const t of tenants) {
    const count = await prisma.fl_Device.count({
      where: { clientName: t.name, isActive: true },
    })

    try {
      const rows = await prisma.$queryRaw<SyncRow[]>`
        WITH updated AS (
          UPDATE tickethub.th_contract_recurring_items ci
          SET quantity = ${count}, "updatedAt" = NOW()
          FROM tickethub.th_contracts c
          JOIN tickethub.th_clients cl ON cl.id = c."clientId"
          WHERE ci."contractId" = c.id
            AND ci."syncSource" = 'fleethub-endpoint-count'
            AND c.status = 'ACTIVE'
            AND cl.name = ${t.name}
          RETURNING ci.id AS "contractItemId",
                    ci.quantity::int AS after,
                    c.name AS "contractName",
                    cl.name AS "clientName"
        )
        SELECT * FROM updated
      `
      synced.push(...rows)
    } catch (err) {
      skipped.push({
        tenant: t.name,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - startedAt,
    tenantsConsidered: tenants.length,
    contractItemsSynced: synced.length,
    skipped,
    sample: synced.slice(0, 5),
  })
})

export const GET = handler
export const POST = handler
