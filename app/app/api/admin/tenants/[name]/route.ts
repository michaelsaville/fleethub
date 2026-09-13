import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"

// PATCH Fl_Tenant fields. Phase 10 WS-A §3.4 extended this route to
// accept the full Phase-9 toggle set + the Phase-10 timezone field
// so the new Tenant settings tab on /clients/[name]?tab=settings can
// drive them from the UI instead of operator-as-Prisma.
//
// Body: any subset of:
//   - Branding: reportLogoUrl, reportAccentColor, reportFooterText
//   - Remote control: remoteControlEnabled, remoteRequiresJustification
//   - Customer portal: portalEnabled, portalReportMaxAgeDays
//   - Security: mfaRequired
//   - PSA sync (Phase 9 WS-C §5.3): psaSyncEnabled
//   - Mutable backup (Phase 9 WS-C §5.4): backupTriggerEnabled,
//     backupTriggerRequiresJustification
//   - Shell sessions (Phase 9 WS-D §6.1): shellSessionsEnabled,
//     shellRequiresJustification, shellMaxDurationMin
//   - File transfer (Phase 9 WS-D §6.2): fileTransferEnabled,
//     fileTransferRequiresJustification, fileTransferMaxSizeMb
//   - Phase 10 WS-C §5.5: timezone (IANA name or null)
// Pass null on a field to clear it where the column is nullable.

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export const PATCH = withAudit(
  {
    action: "tenant.settings.update",
    clientNameFromParams: (params: { name: string }) => decodeURIComponent(params.name),
  },
  async (req: NextRequest, { params }: { params: Promise<{ name: string }> }) => {
    await requireAdmin()
    const { name } = await params
    const tenantName = decodeURIComponent(name)

    const body = (await req.json().catch(() => ({}))) as {
      // branding
      reportLogoUrl?: string | null
      reportAccentColor?: string | null
      reportFooterText?: string | null
      // Phase 7 WS-C remote
      remoteControlEnabled?: boolean
      remoteRequiresJustification?: boolean
      // Phase 7 WS-D portal
      portalEnabled?: boolean
      portalReportMaxAgeDays?: number
      portalRemoteEnabled?: boolean
      // Phase 9 + 10 toggles
      mfaRequired?: boolean
      psaSyncEnabled?: boolean
      backupTriggerEnabled?: boolean
      backupTriggerRequiresJustification?: boolean
      shellSessionsEnabled?: boolean
      shellRequiresJustification?: boolean
      shellMaxDurationMin?: number
      fileTransferEnabled?: boolean
      fileTransferRequiresJustification?: boolean
      fileTransferMaxSizeMb?: number
      timezone?: string | null
      // Phase 11 WS-B+D fields
      bulkApprovalThreshold?: number
      disclosureRequiresApproval?: boolean
      shellApprovalTagsJson?: string | null
      sessionMaxHours?: number
      passwordExpiryDays?: number
    }

    if (
      body.reportAccentColor !== undefined &&
      body.reportAccentColor !== null &&
      !HEX_COLOR_RE.test(body.reportAccentColor)
    ) {
      return NextResponse.json(
        { error: "reportAccentColor must be a 6-digit hex like #F97316" },
        { status: 400 },
      )
    }

    if (
      body.shellMaxDurationMin !== undefined &&
      (body.shellMaxDurationMin < 1 || body.shellMaxDurationMin > 24 * 60)
    ) {
      return NextResponse.json({ error: "shellMaxDurationMin must be 1–1440" }, { status: 400 })
    }
    if (
      body.fileTransferMaxSizeMb !== undefined &&
      (body.fileTransferMaxSizeMb < 1 || body.fileTransferMaxSizeMb > 10 * 1024)
    ) {
      return NextResponse.json({ error: "fileTransferMaxSizeMb must be 1–10240" }, { status: 400 })
    }
    if (
      body.portalReportMaxAgeDays !== undefined &&
      (body.portalReportMaxAgeDays < 1 || body.portalReportMaxAgeDays > 9999)
    ) {
      return NextResponse.json({ error: "portalReportMaxAgeDays must be 1–9999" }, { status: 400 })
    }
    if (
      body.timezone !== undefined &&
      body.timezone !== null &&
      !/^[A-Za-z_]+\/[A-Za-z_]+/.test(body.timezone)
    ) {
      return NextResponse.json(
        { error: "timezone must be an IANA name like America/New_York" },
        { status: 400 },
      )
    }

    // Build update payload from only fields the caller sent.
    const data: Record<string, unknown> = {}
    if (body.reportLogoUrl !== undefined) data.reportLogoUrl = body.reportLogoUrl
    if (body.reportAccentColor !== undefined) {
      data.reportAccentColor = body.reportAccentColor ?? "#F97316"
    }
    if (body.reportFooterText !== undefined) data.reportFooterText = body.reportFooterText
    if (typeof body.remoteControlEnabled === "boolean") data.remoteControlEnabled = body.remoteControlEnabled
    if (typeof body.remoteRequiresJustification === "boolean") data.remoteRequiresJustification = body.remoteRequiresJustification
    if (typeof body.portalEnabled === "boolean") data.portalEnabled = body.portalEnabled
    if (typeof body.portalRemoteEnabled === "boolean") data.portalRemoteEnabled = body.portalRemoteEnabled
    if (typeof body.portalReportMaxAgeDays === "number") data.portalReportMaxAgeDays = body.portalReportMaxAgeDays
    if (typeof body.mfaRequired === "boolean") data.mfaRequired = body.mfaRequired
    if (typeof body.psaSyncEnabled === "boolean") data.psaSyncEnabled = body.psaSyncEnabled
    if (typeof body.backupTriggerEnabled === "boolean") data.backupTriggerEnabled = body.backupTriggerEnabled
    if (typeof body.backupTriggerRequiresJustification === "boolean") data.backupTriggerRequiresJustification = body.backupTriggerRequiresJustification
    if (typeof body.shellSessionsEnabled === "boolean") data.shellSessionsEnabled = body.shellSessionsEnabled
    if (typeof body.shellRequiresJustification === "boolean") data.shellRequiresJustification = body.shellRequiresJustification
    if (typeof body.shellMaxDurationMin === "number") data.shellMaxDurationMin = body.shellMaxDurationMin
    if (typeof body.fileTransferEnabled === "boolean") data.fileTransferEnabled = body.fileTransferEnabled
    if (typeof body.fileTransferRequiresJustification === "boolean") data.fileTransferRequiresJustification = body.fileTransferRequiresJustification
    if (typeof body.fileTransferMaxSizeMb === "number") data.fileTransferMaxSizeMb = body.fileTransferMaxSizeMb
    if (body.timezone !== undefined) data.timezone = body.timezone
    if (typeof body.bulkApprovalThreshold === "number") {
      if (body.bulkApprovalThreshold < 1 || body.bulkApprovalThreshold > 100000) {
        return NextResponse.json(
          { error: "bulkApprovalThreshold must be 1–100000" },
          { status: 400 },
        )
      }
      data.bulkApprovalThreshold = body.bulkApprovalThreshold
    }
    if (typeof body.disclosureRequiresApproval === "boolean") {
      data.disclosureRequiresApproval = body.disclosureRequiresApproval
    }
    if (body.shellApprovalTagsJson !== undefined) {
      // Validate JSON shape: array of strings.
      if (body.shellApprovalTagsJson !== null && body.shellApprovalTagsJson !== "") {
        try {
          const arr = JSON.parse(body.shellApprovalTagsJson) as unknown
          if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
            throw new Error("not a string array")
          }
        } catch (e) {
          return NextResponse.json(
            { error: `shellApprovalTagsJson must be a JSON string array: ${e instanceof Error ? e.message : "parse error"}` },
            { status: 400 },
          )
        }
      }
      data.shellApprovalTagsJson = body.shellApprovalTagsJson || null
    }
    if (typeof body.sessionMaxHours === "number") {
      if (body.sessionMaxHours < 1 || body.sessionMaxHours > 168) {
        return NextResponse.json(
          { error: "sessionMaxHours must be 1–168" },
          { status: 400 },
        )
      }
      data.sessionMaxHours = body.sessionMaxHours
    }
    if (typeof body.passwordExpiryDays === "number") {
      if (body.passwordExpiryDays < 0 || body.passwordExpiryDays > 3650) {
        return NextResponse.json(
          { error: "passwordExpiryDays must be 0–3650 (0 = no expiry)" },
          { status: 400 },
        )
      }
      data.passwordExpiryDays = body.passwordExpiryDays
    }

    const tenant = await prisma.fl_Tenant.upsert({
      where: { name: tenantName },
      update: data,
      create: { name: tenantName, ...data },
    })
    return NextResponse.json({ tenant })
  },
)
