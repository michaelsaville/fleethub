import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { writeAlert } from "@/lib/alert-dispatch"
import { BACKUP_PRODUCTS } from "@/lib/posture"
import { withCronAuth } from "@/lib/with-cron-auth"

export const dynamic = "force-dynamic"

// Phase 8 Workstream B step 3 — backup posture ingest. Agent calls
// this on heartbeat with the per-product detector output. The
// handler updates Fl_Device directly (point-in-time snapshot — no
// sample table) and fires an Fl_Alert when a backup has been
// failing for > 72h.
//
// Body shape:
//   {
//     "clientName": "Acme",
//     "hostname":   "web-1",
//     "product":    "veeam" | "datto" | "restic" | "windows-backup" | "none",
//     "lastSuccessAt": "2026-05-17T08:00:00Z" | null,
//     "lastErrorAt":   "2026-05-17T08:00:00Z" | null,
//     "lastErrorMsg":  "string" | null
//   }
//
// Auth: Bearer FLEETHUB_AGENT_SECRET. Same scheme as the cron
// routes; once agents enroll for real, this will move to the
// per-agent signed-request scheme defined in AGENT-PROTOCOL.md.

interface Body {
  clientName?: string
  hostname?: string
  product?: string
  lastSuccessAt?: string | null
  lastErrorAt?: string | null
  lastErrorMsg?: string | null
}

const ALERT_THRESHOLD_MS = 72 * 60 * 60 * 1000 // 72h

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
  const product = body.product?.trim().toLowerCase()
  if (product && !BACKUP_PRODUCTS.has(product)) {
    return NextResponse.json(
      { error: `product must be one of: ${[...BACKUP_PRODUCTS].join(", ")}` },
      { status: 400 },
    )
  }

  const lastSuccessAt = parseIso(body.lastSuccessAt, "lastSuccessAt")
  if (lastSuccessAt instanceof Error) return NextResponse.json({ error: lastSuccessAt.message }, { status: 400 })
  const lastErrorAt = parseIso(body.lastErrorAt, "lastErrorAt")
  if (lastErrorAt instanceof Error) return NextResponse.json({ error: lastErrorAt.message }, { status: 400 })

  // Posture columns aren't in the generated Prisma client yet
  // (added via raw DDL; client regen pending). Reads via $queryRaw,
  // writes via $executeRaw.
  const deviceRows = await prisma.$queryRaw<{
    id: string
    clientName: string
    hostname: string
    backupLastSuccess: Date | null
  }[]>`
    SELECT id, "clientName", hostname, "backupLastSuccess"
    FROM fleethub.fl_devices
    WHERE "clientName" = ${clientName} AND hostname = ${hostname}
    LIMIT 1
  `
  const device = deviceRows[0]
  if (!device) {
    return NextResponse.json({ error: `device not found: ${clientName}/${hostname}` }, { status: 404 })
  }

  const now = new Date()
  const errorMsg = body.lastErrorMsg?.trim()?.slice(0, 500) ?? null
  await prisma.$executeRaw`
    UPDATE fleethub.fl_devices SET
      "backupProduct"     = ${product ?? null},
      "backupLastSuccess" = ${lastSuccessAt},
      "backupLastError"   = ${lastErrorAt},
      "backupLastErrorMsg"= ${errorMsg},
      "postureReportedAt" = ${now},
      "updatedAt"         = ${now}
    WHERE id = ${device.id}
  `

  // Stale-backup alert. We only fire when the device transitions
  // from "fresh" to "stale" — re-firing on every heartbeat would
  // be noise. Transition detection: previous backupLastSuccess
  // was within the window, current is outside (or null).
  let alertId: string | null = null
  const prevFresh = device.backupLastSuccess
    && now.getTime() - device.backupLastSuccess.getTime() <= ALERT_THRESHOLD_MS
  const currStale = !lastSuccessAt
    || now.getTime() - lastSuccessAt.getTime() > ALERT_THRESHOLD_MS
  if (prevFresh && currStale && product !== "none") {
    try {
      const alert = await writeAlert({
        clientName,
        deviceId: device.id,
        kind: "posture.backup.stale",
        severity: "warn",
        title: `Backup stale on ${hostname}${body.lastErrorMsg ? ` — ${body.lastErrorMsg.slice(0, 100)}` : ""}`,
        detailJson: JSON.stringify({
          product: product ?? null,
          lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
          lastErrorAt: lastErrorAt?.toISOString() ?? null,
          lastErrorMsg: body.lastErrorMsg ?? null,
          thresholdMs: ALERT_THRESHOLD_MS,
        }),
      })
      alertId = alert.id
    } catch {
      // writeAlert audits its own dispatch failures; the ingest
      // itself shouldn't fail because of an alert side-effect.
    }
  }

  await writeAudit({
    clientName,
    deviceId: device.id,
    action: "posture.backup.report",
    outcome: "ok",
    detail: {
      product: product ?? null,
      lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: lastErrorAt?.toISOString() ?? null,
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
