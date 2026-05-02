import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { ingestCisaKev } from "@/lib/cve-ingest"
import { seedPatchesAndInstalls } from "@/lib/patch-mock"

// One-shot ADMIN seeder: pulls CISA KEV catalog + seeds the mock MS
// KB + third-party patch catalog + per-host install state. Becomes
// dead code when real ingest lands (agent WUA aggregation per
// PHASE-4-DESIGN §16, plus a real third-party feed).
export const maxDuration = 180

export async function POST(_req: NextRequest) {
  const session = await requireAdmin()

  const seed = await seedPatchesAndInstalls(session.email)
  const cve = await ingestCisaKev(session.email)

  return NextResponse.json({
    ok: true,
    seed,
    cveIngest: cve,
  })
}
