import "server-only"
import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { renderToBuffer } from "@react-pdf/renderer"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { buildPatchComplianceReport } from "@/lib/reports/patch-compliance"
import { buildSoftwareInventoryReport } from "@/lib/reports/software-inventory"
import { buildPerformanceTrendReport } from "@/lib/reports/performance-trend"
import { PatchComplianceReport } from "@/lib/pdf/PatchComplianceReport"
import { SoftwareInventoryReport } from "@/lib/pdf/SoftwareInventoryReport"
import { PerformanceTrendReport } from "@/lib/pdf/PerformanceTrendReport"

// V1 storage: local disk under REPORTS_DIR (default /tmp/fleethub-reports).
// PHASE-5-DESIGN §4 calls out S3 streaming for large PDFs — Phase 5.5
// adds the storage swap-out.

export const REPORTS_DIR = process.env.REPORTS_DIR || "/tmp/fleethub-reports"

export type ReportKind =
  | "patch-compliance"
  | "software-inventory"
  | "performance-trend"
  | "identity-posture"
  | "qbr"

export const SUPPORTED_KINDS: ReportKind[] = [
  "patch-compliance",
  "software-inventory",
  "performance-trend",
]

export async function generateReport(reportId: string): Promise<void> {
  const report = await prisma.fl_Report.findUnique({ where: { id: reportId } })
  if (!report) throw new Error(`report not found: ${reportId}`)

  await prisma.fl_Report.update({
    where: { id: reportId },
    data: { state: "generating" },
  })

  try {
    // Tenant for branding.
    const tenant = await prisma.fl_Tenant.findUnique({
      where: { name: report.tenantName },
      select: { reportFooterText: true },
    })

    let buffer: Buffer

    if (report.kind === "patch-compliance") {
      const data = await buildPatchComplianceReport({
        tenantName: report.tenantName,
        asOf: report.asOf ?? undefined,
        audience: report.audience as "tech" | "client" | "auditor",
      })
      const element = PatchComplianceReport({
        data,
        footerText: tenant?.reportFooterText ?? null,
        generatedAt: new Date(),
      })
      buffer = await renderToBuffer(element)
    } else if (report.kind === "software-inventory") {
      const data = await buildSoftwareInventoryReport({
        tenantName: report.tenantName,
        asOf: report.asOf ?? undefined,
        audience: report.audience as "tech" | "client" | "auditor",
      })
      const element = SoftwareInventoryReport({
        data,
        footerText: tenant?.reportFooterText ?? null,
        generatedAt: new Date(),
      })
      buffer = await renderToBuffer(element)
    } else if (report.kind === "performance-trend") {
      const data = await buildPerformanceTrendReport({
        tenantName: report.tenantName,
        asOf: report.asOf ?? undefined,
        startDate: report.startDate ?? undefined,
        endDate: report.endDate ?? undefined,
        audience: report.audience as "tech" | "client" | "auditor",
      })
      const element = PerformanceTrendReport({
        data,
        footerText: tenant?.reportFooterText ?? null,
        generatedAt: new Date(),
      })
      buffer = await renderToBuffer(element)
    } else {
      throw new Error(`report kind not implemented: ${report.kind}`)
    }

    // Persist to disk.
    await fs.mkdir(REPORTS_DIR, { recursive: true })
    const filename = `${report.id}.pdf`
    const filepath = path.join(REPORTS_DIR, filename)
    await fs.writeFile(filepath, buffer)
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex")

    await prisma.fl_Report.update({
      where: { id: reportId },
      data: {
        state: "ready",
        artifactUrl: `/api/reports/${report.id}/download`,
        artifactSha256: sha256,
        artifactBytes: buffer.length,
        generatedAt: new Date(),
      },
    })

    await writeAudit({
      actorEmail: report.generatedBy,
      clientName: report.tenantName,
      action: "report.generated",
      outcome: "ok",
      detail: {
        reportId: report.id,
        kind: report.kind,
        audience: report.audience,
        bytes: buffer.length,
        sha256,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.fl_Report.update({
      where: { id: reportId },
      data: { state: "failed", failureReason: message },
    })
    await writeAudit({
      actorEmail: report.generatedBy,
      clientName: report.tenantName,
      action: "report.failed",
      outcome: "error",
      detail: { reportId: report.id, kind: report.kind, error: message },
    })
    throw err
  }
}
