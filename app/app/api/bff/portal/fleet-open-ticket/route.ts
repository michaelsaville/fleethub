import { NextRequest, NextResponse } from "next/server"
import { createHmac } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { verifyHmac } from "@/lib/bff-hmac"

// Phase 8 Workstream D step 6.2 — "Open a ticket" from /fleet on the
// portal. FleetHub is the orchestrator: gathers fleet context (device
// count, last report id, open alerts count) and forwards to
// TicketHub's existing portal ticket-create BFF.
//
// Why route through FleetHub instead of portal → TH directly:
//   - Context lives here. Computing it portal-side would require
//     another fetch + a TH-shaped contract for fleet stats; cheaper
//     to attach it in FH and pass the assembled description to TH.
//   - One signed surface for the portal client. Portal already
//     posts to /api/bff/portal/* on FH for everything else fleet-
//     related; /tickets/new uses TH directly because there's no
//     FH context to attach.
//
// Tenant binding: portalEnabled gate, same as other fleet BFFs.

export const dynamic = "force-dynamic"

interface Body {
  portalUserId?: string
  clientName?: string
  contactId?: string
  description?: string
}

const DEFAULT_TH_BFF = "https://tickethub.pcc2k.com"

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
  const contactId = body.contactId?.trim()
  const portalUserId = body.portalUserId?.trim() ?? ""
  const description = (body.description ?? "").trim()
  if (!clientName || !contactId) {
    return NextResponse.json({ error: "clientName and contactId required" }, { status: 400 })
  }
  if (description.length < 10) {
    return NextResponse.json(
      { error: "Description must be at least 10 characters" },
      { status: 400 },
    )
  }
  if (description.length > 4000) {
    return NextResponse.json({ error: "Description too long (4000 max)" }, { status: 400 })
  }

  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: clientName },
    select: { portalEnabled: true },
  })
  if (!tenant?.portalEnabled) {
    return NextResponse.json({ error: "portal not enabled for this client" }, { status: 403 })
  }

  // Fleet context snapshot. Cheap aggregate queries — same shape
  // the /fleet summary BFF returns; we duplicate so the snapshot is
  // immutable at the moment the ticket was opened (not a stale read
  // of the summary the customer was looking at).
  const [deviceTotal, deviceOnline, openAlerts, lastReport] = await Promise.all([
    prisma.fl_Device.count({ where: { clientName, isActive: true } }),
    prisma.fl_Device.count({ where: { clientName, isActive: true, isOnline: true } }),
    prisma.fl_Alert.count({ where: { clientName, state: "open" } }),
    prisma.fl_Report.findFirst({
      where: { tenantName: clientName, audience: "client", state: { in: ["ready", "delivered"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, createdAt: true },
    }),
  ])

  const fhPublic = (process.env.FLEETHUB_PUBLIC_URL || "https://fleethub.pcc2k.com").replace(/\/$/, "")
  const lastReportLine = lastReport
    ? `Last report: ${lastReport.kind} on ${lastReport.createdAt.toISOString().slice(0, 10)} (${fhPublic}/reports/${lastReport.id})`
    : "Last report: none in the retention window"

  // First-line summary becomes the title. Use up to ~80 chars of the
  // first non-empty line. Keep the operator's words verbatim so the
  // queue triage matches what the customer actually wrote.
  const firstLine = description.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "Fleet question"
  const title = firstLine.length > 80 ? `${firstLine.slice(0, 77).trim()}…` : firstLine

  const enrichedDescription = [
    description,
    "",
    "---",
    "Fleet context at submit (auto-attached by /fleet):",
    `- Devices: ${deviceTotal} (${deviceOnline} online)`,
    `- Open alerts: ${openAlerts}`,
    `- ${lastReportLine}`,
    `- Submitted via portal /fleet`,
  ].join("\n")

  // Forward to TicketHub's existing portal create endpoint. We sign
  // with PORTAL_BFF_SECRET — both apps share that secret (it's the
  // portal-side shared key; the FH→TH leg is just another "trusted
  // app speaking portal protocol").
  const thBaseUrl = (process.env.TICKETHUB_BFF_URL || DEFAULT_TH_BFF).replace(/\/+$/, "")
  const thPath = "/api/bff/portal/tickethub/tickets/create"
  const thBody = JSON.stringify({
    clientName,
    contactId,
    title,
    description: enrichedDescription,
  })
  const ts = Date.now().toString()
  const sig = createHmac("sha256", process.env.PORTAL_BFF_SECRET ?? "")
    .update(`${ts}.${thBody}`)
    .digest("hex")

  let thResponse: { ok: boolean; ticketId?: string; ticketNumber?: number; error?: string }
  try {
    const r = await fetch(`${thBaseUrl}${thPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-portal-timestamp": ts,
        "x-portal-signature": `sha256=${sig}`,
      },
      body: thBody,
      cache: "no-store",
    })
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      thResponse = { ok: false, error: j.error ?? `TicketHub HTTP ${r.status}` }
    } else {
      thResponse = (await r.json()) as typeof thResponse
    }
  } catch (err) {
    thResponse = { ok: false, error: err instanceof Error ? err.message : "TicketHub call failed" }
  }

  await writeAudit({
    clientName,
    action: "portal.fleet.ticket.opened",
    outcome: thResponse.ok ? "ok" : "error",
    detail: {
      portalUserId,
      contactId,
      ticketId: thResponse.ticketId ?? null,
      ticketNumber: thResponse.ticketNumber ?? null,
      contextDeviceTotal: deviceTotal,
      contextOpenAlerts: openAlerts,
      error: thResponse.error ?? null,
    },
  }).catch(() => undefined)

  if (!thResponse.ok || !thResponse.ticketId) {
    return NextResponse.json(
      { error: thResponse.error ?? "TicketHub did not return a ticket" },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ticketId: thResponse.ticketId,
    ticketNumber: thResponse.ticketNumber,
  })
}
