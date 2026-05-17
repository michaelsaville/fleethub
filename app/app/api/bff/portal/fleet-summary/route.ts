import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { verifyHmac } from "@/lib/bff-hmac"
import {
  computePostureScore,
  isBackupStale,
  isAvDisabled,
  isBitlockerOff,
} from "@/lib/posture-score"
import { verifyAuditChain } from "@/lib/audit-chain"

// Phase 7 Workstream D — Super Portal → FleetHub BFF: fleet
// summary card data. The portal verifies the
// (portalUserId, clientName) link on its side before calling;
// FleetHub trusts the call once the HMAC validates and the
// tenant is portal-enabled.
//
// Sanitized output: counts only. Alert TITLES, IPs, inventory
// detail never leave FleetHub through this route — customer
// portal is read-only by design.

export const dynamic = "force-dynamic"

interface Body {
  portalUserId?: string
  clientName?: string
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const verify = verifyHmac(
    rawBody,
    req.headers.get("x-portal-signature"),
    req.headers.get("x-portal-timestamp"),
    process.env.PORTAL_BFF_SECRET ?? "",
  )
  if (!verify.ok) return NextResponse.json({ error: verify.reason }, { status: verify.status })

  let body: Body
  try { body = JSON.parse(rawBody) as Body } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }
  const clientName = body.clientName?.trim()
  const portalUserId = body.portalUserId?.trim() ?? ""
  if (!clientName) return NextResponse.json({ error: "clientName required" }, { status: 400 })

  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: clientName },
    select: { portalEnabled: true },
  })
  if (!tenant?.portalEnabled) {
    return NextResponse.json({ error: "portal not enabled for this client" }, { status: 403 })
  }

  const offlineCutoff = new Date(Date.now() - 24 * 60 * 60_000)
  const [deviceTotal, deviceOnline, hostsOffline24h, openAlerts, latestPatchScan, latestReport] = await Promise.all([
    prisma.fl_Device.count({ where: { clientName, isActive: true } }),
    prisma.fl_Device.count({ where: { clientName, isActive: true, isOnline: true } }),
    prisma.fl_Device.count({ where: { clientName, isActive: true, lastSeenAt: { lt: offlineCutoff } } }),
    prisma.fl_Alert.count({ where: { clientName, state: "open" } }),
    prisma.fl_Device.findFirst({
      where: { clientName, isActive: true, lastSeenAt: { not: null } },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true },
    }),
    prisma.fl_Report.findFirst({
      where: { tenantName: clientName, state: { in: ["ready", "delivered"] } },
      orderBy: { generatedAt: "desc" },
      select: { id: true, kind: true, generatedAt: true },
    }),
  ])

  await writeAudit({
    clientName,
    action: "portal.fleet.summary.viewed",
    outcome: "ok",
    detail: { portalUserId },
  }).catch(() => undefined)

  // Phase 8 WS-B step 6 — compliance posture score (0-100). Same
  // formula MSP uses, scoped to this client's devices. Customer
  // portal renders the chip only — they don't need the per-rule
  // breakdown the staff /msp page shows.
  type PostureSampleRow = {
    backupLastSuccess: Date | null
    backupProduct: string | null
    avEngine: string | null
    avEnabled: boolean | null
    bitlockerOn: boolean | null
  }
  const [postureRows, tenantPosture, hostsBehindPatchRow, auditChain] = await Promise.all([
    prisma.$queryRaw<PostureSampleRow[]>`
      SELECT "backupLastSuccess", "backupProduct",
             "avEngine", "avEnabled", "bitlockerOn"
      FROM fleethub.fl_devices
      WHERE "clientName" = ${clientName}
        AND "isActive" = true
        AND "maintenanceMode" = false
    `.catch((): PostureSampleRow[] => []),
    prisma.fl_Tenant.findUnique({ where: { name: clientName }, select: { hipaaMode: true } }),
    // hostsBehindPatch — distinct devices with any state="missing"
    // install. Same definition the MSP rollup uses.
    prisma.fl_PatchInstall.findMany({
      where: {
        state: "missing",
        // join via patch's tenant? No — Fl_PatchInstall.deviceId.
        // We want count of distinct deviceIds whose device.clientName matches.
      },
      select: { deviceId: true },
    }).then(async (rows) => {
      if (rows.length === 0) return 0
      const ids = Array.from(new Set(rows.map((r) => r.deviceId)))
      const owned = await prisma.fl_Device.count({
        where: { id: { in: ids }, clientName, isActive: true },
      })
      return owned
    }).catch(() => 0),
    verifyAuditChain().catch(() => ({ intact: true, brokenAt: null })),
  ])

  const now = Date.now()
  let hostsBackupStale = 0
  let hostsAvDisabled = 0
  let hostsBitlockerOff = 0
  for (const p of postureRows) {
    if (isBackupStale(p.backupLastSuccess, p.backupProduct, now)) hostsBackupStale++
    if (isAvDisabled(p.avEnabled, p.avEngine))                    hostsAvDisabled++
    if (isBitlockerOff(p.bitlockerOn))                            hostsBitlockerOff++
  }
  const auditBroken =
    !auditChain.intact && auditChain.brokenAt?.clientName === clientName

  const postureScore = computePostureScore({
    deviceTotal,
    hostsBehindPatch: hostsBehindPatchRow,
    hostsBackupStale,
    hostsAvDisabled,
    hostsBitlockerOff,
    hipaaMode: Boolean(tenantPosture?.hipaaMode),
    auditChainBroken: auditBroken,
  }).score

  return NextResponse.json({
    deviceCount: deviceTotal,
    onlineCount: deviceOnline,
    hostsOffline24h,
    openAlerts,
    postureScore,
    latestActivityAt: latestPatchScan?.lastSeenAt?.toISOString() ?? null,
    latestReport: latestReport
      ? { id: latestReport.id, kind: latestReport.kind, generatedAt: latestReport.generatedAt?.toISOString() ?? null }
      : null,
  })
}
