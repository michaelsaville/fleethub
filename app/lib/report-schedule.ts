import "server-only"
import { promises as fs } from "node:fs"
import path from "node:path"
import { CronExpressionParser } from "cron-parser"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { generateReport, REPORTS_DIR } from "@/lib/reports/render"
import { sendReportEmail, m365Configured } from "@/lib/m365-mail"

// PHASE-5-DESIGN §5: Fl_ReportSchedule cron worker.
//
// Fire model: idempotent per `lastFiredAt`. The cron worker is invoked
// by the host crontab (e.g. every 5 minutes); for each active schedule,
// we ask cron-parser for the most recent "should-have-fired" time and
// compare it to lastFiredAt. If lastFiredAt < that time AND the
// should-have-fired time has actually passed, the schedule fires.
//
// Date-range tokens (per design §5):
//   "last-7d" | "last-30d" | "last-90d" | "month-to-date" | "quarter-to-date"
// Resolved at fire time, NOT at schedule-create time, so the next fire
// always picks up a fresh window.
//
// Delivery v1 = email only. Slack/Teams thumbnail is Phase 5.5 step #8.
//
// Failure handling: a generation or delivery failure writes
// Fl_ReportSchedule.lastError + lastErrorAt but DOES bump lastFiredAt
// so we don't re-fire the same window on the next cron tick.

export type DateRangeToken =
  | "last-7d"
  | "last-30d"
  | "last-90d"
  | "month-to-date"
  | "quarter-to-date"

export interface DeliveryConfig {
  email?: { to: string[]; cc?: string[] }
  /** Phase 5.5. v1 ignores this field. */
  slack?: { webhookUrl: string }
}

export function resolveDateRange(
  token: string,
  asOf: Date,
): { startDate: Date; endDate: Date } {
  const endDate = asOf
  switch (token) {
    case "last-7d":
      return { startDate: new Date(endDate.getTime() - 7 * 86_400_000), endDate }
    case "last-30d":
      return { startDate: new Date(endDate.getTime() - 30 * 86_400_000), endDate }
    case "last-90d":
      return { startDate: new Date(endDate.getTime() - 90 * 86_400_000), endDate }
    case "month-to-date": {
      const sd = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1))
      return { startDate: sd, endDate }
    }
    case "quarter-to-date": {
      const q = Math.floor(endDate.getUTCMonth() / 3)
      const sd = new Date(Date.UTC(endDate.getUTCFullYear(), q * 3, 1))
      return { startDate: sd, endDate }
    }
    default:
      // Unknown token — treat as last-30d so a typo doesn't crash the worker.
      return { startDate: new Date(endDate.getTime() - 30 * 86_400_000), endDate }
  }
}

/** Find schedules whose most recent should-fire time is after lastFiredAt. */
export async function findDueSchedules(now = new Date()) {
  const schedules = await prisma.fl_ReportSchedule.findMany({
    where: { isActive: true },
  })
  const due: Array<{
    schedule: (typeof schedules)[number]
    fireTime: Date
  }> = []
  for (const s of schedules) {
    let prev: Date
    try {
      const it = CronExpressionParser.parse(s.cron, {
        tz: s.timezone || "UTC",
        currentDate: now,
      })
      prev = it.prev().toDate()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[report-schedule] invalid cron "${s.cron}" on schedule ${s.id}: ${msg}`)
      continue
    }
    // Has the should-fire time actually passed, AND have we not yet fired
    // for it?  lastFiredAt null = never fired = fire now.
    const lastFired = s.lastFiredAt ?? new Date(0)
    if (prev > lastFired && prev <= now) {
      due.push({ schedule: s, fireTime: prev })
    }
  }
  return due
}

interface FireResult {
  scheduleId: string
  reportId: string | null
  state: "delivered" | "ready-but-no-delivery" | "failed"
  error?: string
}

/** Fire a single schedule: create Fl_Report, generate, deliver. */
export async function fireSchedule(
  schedule: { id: string; tenantName: string; kind: string; audience: string; format: string; dateRange: string; deliveryJson: string; createdBy: string },
  fireTime: Date,
): Promise<FireResult> {
  // 1. Resolve the date range relative to the fire time.
  const { startDate, endDate } = resolveDateRange(schedule.dateRange, fireTime)

  // 2. Per-tenant retention default (matches /api/reports POST).
  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: schedule.tenantName },
    select: { reportRetentionDays: true },
  })
  const retentionDays = tenant?.reportRetentionDays ?? 2190
  const retentionUntil = new Date(fireTime.getTime() + retentionDays * 86_400_000)

  // 3. Create the Fl_Report row tagged with this schedule.
  const report = await prisma.fl_Report.create({
    data: {
      kind: schedule.kind,
      tenantName: schedule.tenantName,
      audience: schedule.audience,
      startDate,
      endDate,
      // Patch-compliance and identity-posture are point-in-time; encode as
      // asOf for the renderer that expects that shape. Other kinds ignore.
      asOf: endDate,
      format: schedule.format,
      generatedBy: `schedule:${schedule.id}`,
      scheduleId: schedule.id,
      retentionUntil,
      state: "queued",
    },
  })

  // 4. Generate the PDF.
  try {
    await generateReport(report.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { scheduleId: schedule.id, reportId: report.id, state: "failed", error: `generate: ${msg}` }
  }

  // 5. Deliver via email (v1 only).
  let delivery: DeliveryConfig
  try {
    delivery = JSON.parse(schedule.deliveryJson)
  } catch {
    return { scheduleId: schedule.id, reportId: report.id, state: "failed", error: "deliveryJson is not valid JSON" }
  }
  if (!delivery.email?.to?.length) {
    // No email configured — leave the row in state=ready and don't bump deliveredAt.
    return { scheduleId: schedule.id, reportId: report.id, state: "ready-but-no-delivery" }
  }

  try {
    if (!m365Configured()) {
      throw new Error("M365 not configured (set AZURE_AD_* + M365_SENDER_UPN in fleethub/.env)")
    }
    const filepath = path.join(REPORTS_DIR, `${report.id}.pdf`)
    const pdfBytes = await fs.readFile(filepath)
    const filename = filenameFor(schedule.kind, schedule.tenantName, fireTime)
    const subject = subjectFor(schedule.kind, schedule.tenantName, startDate, endDate)
    await sendReportEmail({
      to: delivery.email.to,
      cc: delivery.email.cc,
      subject,
      htmlBody: bodyFor(schedule.kind, schedule.tenantName, startDate, endDate, schedule.audience),
      pdfBytes,
      pdfFilename: filename,
    })
    await prisma.fl_Report.update({
      where: { id: report.id },
      data: { state: "delivered", deliveredAt: new Date() },
    })
    await writeAudit({
      actorEmail: schedule.createdBy,
      clientName: schedule.tenantName,
      action: "report.delivered",
      outcome: "ok",
      detail: { reportId: report.id, scheduleId: schedule.id, recipients: delivery.email.to.length },
    })
    return { scheduleId: schedule.id, reportId: report.id, state: "delivered" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { scheduleId: schedule.id, reportId: report.id, state: "failed", error: `deliver: ${msg}` }
  }
}

/** Process every due schedule. Idempotent — bumps lastFiredAt regardless of
 *  outcome to avoid re-firing the same window on the next cron tick. */
export async function fireDueSchedules(now = new Date()): Promise<{
  fired: FireResult[]
  scanned: number
}> {
  const due = await findDueSchedules(now)
  const results: FireResult[] = []
  for (const { schedule, fireTime } of due) {
    const result = await fireSchedule(schedule, fireTime)
    results.push(result)
    // Bump lastFiredAt unconditionally — failure path still records "we tried".
    if (result.state === "failed") {
      await prisma.fl_ReportSchedule.update({
        where: { id: schedule.id },
        data: {
          lastFiredAt: fireTime,
          lastErrorAt: new Date(),
          lastError: (result.error ?? "unknown").slice(0, 500),
        },
      })
    } else {
      await prisma.fl_ReportSchedule.update({
        where: { id: schedule.id },
        data: { lastFiredAt: fireTime, lastError: null, lastErrorAt: null },
      })
    }
  }
  return { fired: results, scanned: due.length }
}

function filenameFor(kind: string, tenantName: string, when: Date): string {
  const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const date = when.toISOString().slice(0, 10)
  return `${kind}-${slug}-${date}.pdf`
}

function subjectFor(kind: string, tenantName: string, start: Date, end: Date): string {
  const window = `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`
  return `[FleetHub] ${labelFor(kind)} - ${tenantName} - ${window}`
}

function bodyFor(
  kind: string,
  tenantName: string,
  start: Date,
  end: Date,
  audience: string,
): string {
  const window = `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`
  return [
    `<p>Hi,</p>`,
    `<p>Attached is the latest <strong>${escapeHtml(labelFor(kind))}</strong> report for <strong>${escapeHtml(tenantName)}</strong> covering ${escapeHtml(window)} (${escapeHtml(audience)} view).</p>`,
    `<p>This report was generated automatically by FleetHub on the schedule configured for this tenant. To change the cadence or recipients, edit the schedule at <a href="https://fleethub.pcc2k.com/reports/scheduled">fleethub.pcc2k.com/reports/scheduled</a>.</p>`,
    `<p>-- FleetHub</p>`,
  ].join("")
}

function labelFor(kind: string): string {
  switch (kind) {
    case "patch-compliance": return "Patch Compliance"
    case "software-inventory": return "Software Inventory"
    case "performance-trend": return "Performance Trend"
    case "qbr": return "Quarterly Business Review"
    case "identity-posture": return "Identity Posture"
    default: return kind
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
