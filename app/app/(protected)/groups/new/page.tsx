import AppShell from "@/components/AppShell"
import { Card } from "@/components/ui/Card"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import GroupForm from "../GroupForm"

export const dynamic = "force-dynamic"

export default async function NewGroupPage() {
  await requireAdmin()
  const tenants = await prisma.fl_Tenant.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
        <header>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4 }}>
            New device group
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0 }}>
            Pinned device list, RQL fragment, or both. Member count refreshes
            on save.
          </p>
        </header>
        <Card>
          <GroupForm tenants={tenants.map((t) => t.name)} mode="create" />
        </Card>
      </div>
    </AppShell>
  )
}
