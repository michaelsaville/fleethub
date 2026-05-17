import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { verifyHmac } from "@/lib/bff-hmac"

// Phase 8 Workstream D step 6.2 — fleet patch posture for the
// customer portal. Sanitized: counts by severity band only.
// Deliberate omissions:
//   - No CVE IDs (CVE attribution implies known-vuln status of a
//     specific host — too much detail for the portal scope).
//   - No per-host or per-patch detail (handled in `/fleet/devices`
//     on the staff side).
//   - No advisory titles (would re-introduce CVE-style exposure).
//
// What IS returned:
//   - Three severity buckets — critical / high / other — counting
//     distinct *missing* patch installs across the client's active,
//     non-maintenance devices.
//   - KEV count (Known Exploited Vulnerabilities) called out
//     separately because that's the bucket that drives the "patch
//     now" conversation.
//   - The number of devices contributing to the count + how many
//     have *zero* missing patches (the "fully patched" subset).

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

  // The contributing device set — active, not in maintenance mode.
  const devices = await prisma.fl_Device.findMany({
    where: { clientName, isActive: true, maintenanceMode: false },
    select: { id: true },
  })
  const deviceCount = devices.length
  const deviceIds = devices.map((d) => d.id)

  if (deviceCount === 0) {
    await writeAudit({
      clientName,
      action: "portal.fleet.patches.viewed",
      outcome: "ok",
      detail: { portalUserId, deviceCount: 0 },
    }).catch(() => undefined)
    return NextResponse.json({
      deviceCount: 0,
      devicesFullyPatched: 0,
      critical: 0,
      high: 0,
      other: 0,
      kev: 0,
      lastScanAt: null,
    })
  }

  // Pull all missing installs in one go — joined patch for severity
  // bucketing. We bucket via classification + KEV + cvssMax rather
  // than expose the underlying scores; bands are stable language for
  // customers who don't speak CVSS.
  const missing = await prisma.fl_PatchInstall.findMany({
    where: { deviceId: { in: deviceIds }, state: "missing" },
    select: {
      deviceId: true,
      lastDetectedAt: true,
      patch: {
        select: {
          id: true,
          classification: true,
          cvssMax: true,
          isKev: true,
          approvalState: true,
        },
      },
    },
  })

  // Devices that contributed at least one missing → not fully patched.
  const devicesWithMissing = new Set(missing.map((m) => m.deviceId))
  const devicesFullyPatched = deviceCount - devicesWithMissing.size

  let critical = 0
  let high = 0
  let other = 0
  let kev = 0
  let lastScanAt: Date | null = null

  for (const m of missing) {
    // approvalState declined / auto-declined: the client's MSP has
    // *chosen* not to deploy this. Excluding from the customer view
    // avoids the awkward "you still have these missing" when the
    // tech has actively decided to skip them.
    if (m.patch.approvalState === "declined" || m.patch.approvalState === "auto-declined") {
      continue
    }
    if (m.patch.isKev) kev += 1
    if (m.patch.isKev || (m.patch.cvssMax ?? 0) >= 9) {
      critical += 1
    } else if ((m.patch.cvssMax ?? 0) >= 7) {
      high += 1
    } else {
      other += 1
    }
    if (!lastScanAt || m.lastDetectedAt > lastScanAt) {
      lastScanAt = m.lastDetectedAt
    }
  }

  await writeAudit({
    clientName,
    action: "portal.fleet.patches.viewed",
    outcome: "ok",
    detail: {
      portalUserId,
      deviceCount,
      missing: critical + high + other,
      kev,
    },
  }).catch(() => undefined)

  return NextResponse.json({
    deviceCount,
    devicesFullyPatched,
    critical,
    high,
    other,
    kev,
    lastScanAt: lastScanAt?.toISOString() ?? null,
  })
}
