import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import RunbookForm from "../RunbookForm"

export const dynamic = "force-dynamic"

export default async function NewRunbookPage() {
  await requireAdmin()
  const scripts = await prisma.fl_Script.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, shell: true, category: true, dryRunCapable: true },
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: 760 }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            New runbook
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Bind an alert pattern to a signed script. After the grace
            window, matching alerts trigger the script on the affected
            device through Phase 2&rsquo;s existing runScript()
            pipeline — no transport changes, no script-content
            bypass.
          </p>
        </header>
        <RunbookForm
          initial={{
            id: null,
            name: "",
            description: "",
            severity: [],
            kindLike: "",
            scriptId: "",
            graceMin: 2,
            cooldownMin: 30,
            maxFiresPerHour: 10,
            maxConsecutiveFailures: 3,
            dryRunFirst: true,
            dryRunPredicate: "",
            isActive: true,
          }}
          scripts={scripts}
        />
      </div>
    </AppShell>
  )
}
