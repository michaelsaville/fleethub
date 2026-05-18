import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit, addAuditDetail } from "@/lib/with-audit"

// Phase 12 WS-A.7 — Fl_NetworkDevice CRUD (POST creates).

export const dynamic = "force-dynamic"

const VALID_KINDS = ["switch", "router", "firewall", "ap", "printer", "ups", "other"]

export const POST = withAudit(
  { action: "network-device.create" },
  async (req: NextRequest) => {
    const session = await requireAdmin()
    const body = (await req.json().catch(() => ({}))) as {
      clientName?: string
      displayName?: string
      ipAddress?: string
      kind?: string
      snmpVersion?: string
      snmpCredentialId?: string | null
      icmpEnabled?: boolean
      pollIntervalSec?: number
    }
    if (!body.clientName?.trim() || !body.displayName?.trim() || !body.ipAddress?.trim() || !body.kind) {
      return NextResponse.json(
        { error: "clientName, displayName, ipAddress, kind required" },
        { status: 400 },
      )
    }
    if (!VALID_KINDS.includes(body.kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${VALID_KINDS.join(", ")}` },
        { status: 400 },
      )
    }
    const snmpVersion = body.snmpVersion ?? "none"
    if (!["none", "v2c", "v3"].includes(snmpVersion)) {
      return NextResponse.json(
        { error: "snmpVersion must be none | v2c | v3" },
        { status: 400 },
      )
    }
    if (snmpVersion !== "none" && !body.snmpCredentialId) {
      return NextResponse.json(
        { error: "snmpCredentialId required when snmpVersion is v2c or v3" },
        { status: 400 },
      )
    }
    const pollIntervalSec = body.pollIntervalSec ?? 60
    if (pollIntervalSec < 10 || pollIntervalSec > 3600) {
      return NextResponse.json(
        { error: "pollIntervalSec must be 10-3600" },
        { status: 400 },
      )
    }
    const created = await prisma.fl_NetworkDevice.create({
      data: {
        clientName: body.clientName.trim(),
        displayName: body.displayName.trim(),
        ipAddress: body.ipAddress.trim(),
        kind: body.kind,
        snmpVersion,
        snmpCredentialId: body.snmpCredentialId ?? null,
        icmpEnabled: body.icmpEnabled !== false,
        pollIntervalSec,
        createdBy: session.email,
      },
    })
    addAuditDetail(req, { networkDeviceId: created.id, tenant: created.clientName })
    return NextResponse.json({ id: created.id }, { status: 201 })
  },
)
