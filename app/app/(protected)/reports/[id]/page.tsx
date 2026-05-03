import AppShell from "@/components/AppShell"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import ReportViewer from "./ReportViewer"

export const dynamic = "force-dynamic"

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ autorun?: string }>
}) {
  const { id } = await params
  const { autorun } = await searchParams
  const report = await prisma.fl_Report.findUnique({ where: { id } })
  if (!report) notFound()

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980 }}>
        <header>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
            <a href="/reports" style={{ color: "inherit", textDecoration: "none" }}>← Reports</a>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4 }}>
            {report.kind} · {report.tenantName}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0 }}>
            Audience: {report.audience} · Created {new Date(report.createdAt).toLocaleString()}
          </p>
        </header>

        <ReportViewer
          reportId={report.id}
          initialState={report.state}
          autorun={autorun === "1" && report.state === "queued"}
        />
      </div>
    </AppShell>
  )
}
