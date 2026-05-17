import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { writeAlert } from "@/lib/alert-dispatch"
import { AV_ENGINES } from "@/lib/posture"
import { withCronAuth } from "@/lib/with-cron-auth"

export const dynamic = "force-dynamic"

// Phase 8 Workstream B step 3 — AV/EDR + encryption posture ingest.
// Agent calls this with the output of `Get-MpComputerStatus` (Windows)
// or the equivalent Linux/macOS check. BitLocker reporting is grouped
// here because the same heartbeat path collects it.
//
// Body shape:
//   {
//     "clientName":     "Acme",
//     "hostname":       "web-1",
//     "engine":         "defender" | "crowdstrike" | "sophos" | "sentinelone" | "bitdefender" | "none",
//     "enabled":        true,
//     "signaturesAt":   "2026-05-17T08:00:00Z" | null,
//     "bitlockerOn":    true | false | null,
//     "warrantyExpiresAt": "2027-01-01" | null
//   }

interface Body {
  clientName?: string
  hostname?: string
  engine?: string
  enabled?: boolean | null
  signaturesAt?: string | null
  bitlockerOn?: boolean | null
  warrantyExpiresAt?: string | null
}

export const POST = withCronAuth<NextRequest>(async (req) => {
  let body: Body
  try { body = (await req.json()) as Body } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const clientName = body.clientName?.trim()
  const hostname = body.hostname?.trim()
  if (!clientName || !hostname) {
    return NextResponse.json({ error: "clientName and hostname required" }, { status: 400 })
  }
  const engine = body.engine?.trim().toLowerCase()
  if (engine && !AV_ENGINES.has(engine)) {
    return NextResponse.json(
      { error: `engine must be one of: ${[...AV_ENGINES].join(", ")}` },
      { status: 400 },
    )
  }

  const signaturesAt = parseIso(body.signaturesAt, "signaturesAt")
  if (signaturesAt instanceof Error) return NextResponse.json({ error: signaturesAt.message }, { status: 400 })
  const warrantyExpiresAt = parseIso(body.warrantyExpiresAt, "warrantyExpiresAt")
  if (warrantyExpiresAt instanceof Error) return NextResponse.json({ error: warrantyExpiresAt.message }, { status: 400 })

  const enabled = body.enabled === null || body.enabled === undefined ? null : Boolean(body.enabled)
  const bitlockerOn = body.bitlockerOn === null || body.bitlockerOn === undefined ? null : Boolean(body.bitlockerOn)

  // Posture columns aren't in the generated Prisma client yet
  // (added via raw DDL; client regen pending). Reads via $queryRaw,
  // writes via $executeRaw.
  const deviceRows = await prisma.$queryRaw<{
    id: string
    clientName: string
    hostname: string
    avEnabled: boolean | null
    bitlockerOn: boolean | null
  }[]>`
    SELECT id, "clientName", hostname, "avEnabled", "bitlockerOn"
    FROM fleethub.fl_devices
    WHERE "clientName" = ${clientName} AND hostname = ${hostname}
    LIMIT 1
  `
  const device = deviceRows[0]
  if (!device) {
    return NextResponse.json({ error: `device not found: ${clientName}/${hostname}` }, { status: 404 })
  }

  const now = new Date()
  await prisma.$executeRaw`
    UPDATE fleethub.fl_devices SET
      "avEngine"          = ${engine ?? null},
      "avEnabled"         = ${enabled},
      "avSignaturesAt"    = ${signaturesAt},
      "bitlockerOn"       = ${bitlockerOn},
      "warrantyExpiresAt" = ${warrantyExpiresAt},
      "postureReportedAt" = ${now},
      "updatedAt"         = ${now}
    WHERE id = ${device.id}
  `

  // Alert on a transition to AV-disabled. avEnabled going from
  // true → false fires; null → false is treated as a fresh report,
  // not a transition (no alert), so initial enrollment doesn't
  // immediately page anyone.
  let alertId: string | null = null
  if (device.avEnabled === true && enabled === false && engine !== "none") {
    try {
      const alert = await writeAlert({
        clientName,
        deviceId: device.id,
        kind: "posture.av.disabled",
        severity: "critical",
        title: `AV disabled on ${hostname} (${engine ?? "unknown engine"})`,
        detailJson: JSON.stringify({
          engine: engine ?? null,
          signaturesAt: signaturesAt?.toISOString() ?? null,
          bitlockerOn,
        }),
      })
      alertId = alert.id
    } catch {
      // writeAlert audits its own dispatch failures.
    }
  }

  await writeAudit({
    clientName,
    deviceId: device.id,
    action: "posture.av.report",
    outcome: "ok",
    detail: {
      engine: engine ?? null,
      enabled,
      bitlockerOn,
      alertFired: alertId !== null,
    },
  }).catch(() => undefined)

  return NextResponse.json({ ok: true, alertId })
})

function parseIso(s: string | null | undefined, fieldName: string): Date | null | Error {
  if (s === null || s === undefined || s === "") return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return new Error(`${fieldName} is not a valid ISO timestamp`)
  return d
}
