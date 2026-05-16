import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import RunbookForm from "../../RunbookForm"

export const dynamic = "force-dynamic"

type Severity = "critical" | "warn" | "info"
interface StoredMatch {
  severity?: string[] | string
  kindLike?: string
}

export default async function EditRunbookPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params

  const [runbook, scripts] = await Promise.all([
    prisma.fl_Runbook.findUnique({ where: { id } }),
    prisma.fl_Script.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, shell: true, category: true, dryRunCapable: true },
    }),
  ])
  if (!runbook) notFound()

  let parsedMatch: StoredMatch = {}
  try { parsedMatch = JSON.parse(runbook.matchJson) as StoredMatch } catch { /* shrug */ }

  const severityIn = parsedMatch.severity
  const severity: Severity[] = []
  if (Array.isArray(severityIn)) {
    for (const s of severityIn) {
      if (s === "critical" || s === "warn" || s === "info") severity.push(s)
    }
  } else if (severityIn === "critical" || severityIn === "warn" || severityIn === "info") {
    severity.push(severityIn)
  }

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: 760 }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Edit runbook
          </h1>
          <p style={{ fontSize: "12px", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "var(--color-text-secondary)" }}>
            {runbook.id}
          </p>
        </header>
        <RunbookForm
          initial={{
            id: runbook.id,
            name: runbook.name,
            description: runbook.description ?? "",
            severity,
            kindLike: parsedMatch.kindLike ?? "",
            scriptId: runbook.scriptId,
            graceMin: runbook.graceMin,
            cooldownMin: runbook.cooldownMin,
            maxFiresPerHour: runbook.maxFiresPerHour,
            maxConsecutiveFailures: runbook.maxConsecutiveFailures,
            dryRunFirst: runbook.dryRunFirst,
            dryRunPredicate: runbook.dryRunPredicateJson ?? "",
            isActive: runbook.isActive,
          }}
          scripts={scripts}
        />
      </div>
    </AppShell>
  )
}
