import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { REPORTS_DIR } from "@/lib/reports/render"
import { writeAudit } from "@/lib/audit"

// Phase 5 step 13 — Fl_Report retention sweep.
//
// Reports past Fl_Report.retentionUntil have their on-disk artifact
// unlinked and the row flipped to state="expired" with artifactUrl
// cleared. Per HIPAA-READY §2 retention is 6 years (the
// Fl_Tenant.reportRetentionDays default of 2190d); operators can set
// shorter tenants for non-PHI clients, and the retentionUntil is
// captured at create-time so an operator can shorten the policy
// without retroactively destroying older reports.
//
// Bearer-gated with FLEETHUB_AGENT_SECRET (same as patches-scan,
// perf-rollup, etc.).
//
// Cadence: daily, e.g. crontab `30 2 * * *`.

export const maxDuration = 300
export const dynamic = "force-dynamic"

interface ExpireOutcome {
  reportId: string
  state: "expired" | "skipped" | "error"
  fileUnlinked: boolean
  reason?: string
}

export async function GET(req: NextRequest) {
  return run(req)
}
export async function POST(req: NextRequest) {
  return run(req)
}

async function run(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? ""
  const secret = process.env.FLEETHUB_AGENT_SECRET ?? ""
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const now = new Date()
  // The @@index([state, retentionUntil]) on Fl_Report exists for this
  // exact query. Bound the batch so a backlog after a long outage doesn't
  // hold the request open past maxDuration; the cron just picks up the
  // next batch on the next fire.
  const due = await prisma.fl_Report.findMany({
    where: {
      retentionUntil: { lt: now },
      state: { notIn: ["expired"] },
      artifactUrl: { not: null },
    },
    take: 200,
    orderBy: { retentionUntil: "asc" },
    select: {
      id: true,
      tenantName: true,
      kind: true,
      format: true,
      retentionUntil: true,
    },
  })

  const outcomes: ExpireOutcome[] = []
  for (const report of due) {
    const ext = report.format === "evidence-zip" ? "zip" : "pdf"
    const filepath = path.join(REPORTS_DIR, `${report.id}.${ext}`)
    let fileUnlinked = false
    try {
      await fs.unlink(filepath)
      fileUnlinked = true
    } catch (err) {
      // Missing file is fine — sometimes the artifact was already
      // sweep-cleaned by an out-of-band process. Other errors (perms,
      // I/O) we record but still flip the DB row so we don't loop.
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        console.warn(`[report-expire] unlink ${filepath} failed:`, err)
      }
    }
    try {
      await prisma.fl_Report.update({
        where: { id: report.id },
        data: {
          state: "expired",
          artifactUrl: null,
          artifactSha256: null,
          artifactBytes: null,
        },
      })
      await writeAudit({
        actorEmail: null,
        clientName: report.tenantName,
        action: "report.retention.expired",
        outcome: "ok",
        detail: {
          reportId: report.id,
          kind: report.kind,
          format: report.format,
          retentionUntil: report.retentionUntil.toISOString(),
          fileUnlinked,
        },
      })
      outcomes.push({ reportId: report.id, state: "expired", fileUnlinked })
    } catch (err) {
      console.warn(`[report-expire] DB update failed for ${report.id}:`, err)
      outcomes.push({
        reportId: report.id,
        state: "error",
        fileUnlinked,
        reason: (err as Error).message,
      })
    }
  }

  return NextResponse.json({
    sweptAt: now.toISOString(),
    examined: due.length,
    expired: outcomes.filter((o) => o.state === "expired").length,
    errors: outcomes.filter((o) => o.state === "error").length,
    outcomes,
  })
}
