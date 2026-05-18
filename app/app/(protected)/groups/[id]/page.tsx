import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { resolveGroupTargets } from "@/lib/targeting"
import GroupForm from "../GroupForm"
import DeleteGroupButton from "./DeleteGroupButton"

export const dynamic = "force-dynamic"

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const group = await prisma.fl_DeviceGroup.findUnique({ where: { id } })
  if (!group) notFound()

  const [tenants, members] = await Promise.all([
    prisma.fl_Tenant.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    resolveGroupTargets(id),
  ])

  let pinned: string[] = []
  if (group.pinnedDeviceIdsJson) {
    try {
      const parsed = JSON.parse(group.pinnedDeviceIdsJson)
      if (Array.isArray(parsed)) pinned = parsed.filter((s): s is string => typeof s === "string")
    } catch { /* skip */ }
  }

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 920 }}>
        <nav style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>
          <Link href="/groups" style={{ color: "var(--color-text-secondary)", textDecoration: "none" }}>
            Device groups
          </Link>
          <span style={{ margin: "0 6px" }}>›</span>
          <span>{group.name}</span>
        </nav>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4 }}>
              {group.name}
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0 }}>
              {group.tenantName} · {members.length} member{members.length === 1 ? "" : "s"}
            </p>
          </div>
          <DeleteGroupButton id={group.id} name={group.name} />
        </header>

        <Card>
          <CardHeader title="Edit" />
          <GroupForm
            tenants={tenants.map((t) => t.name)}
            mode="edit"
            initial={{
              id: group.id,
              tenantName: group.tenantName,
              name: group.name,
              rql: group.rql,
              pinnedDeviceIds: pinned,
            }}
          />
        </Card>

        <Card>
          <CardHeader title={`Members · ${members.length}`} />
          {members.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
              No devices match the pinned list or RQL. Add a pinned ID or set an RQL fragment.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {members.map((d) => (
                <li key={d.id} style={{ display: "flex", gap: 12, fontSize: 12.5, padding: "4px 0", borderBottom: "0.5px dashed var(--color-border-tertiary)" }}>
                  <Link href={`/devices/${d.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5 }}>
                    {d.hostname}
                  </Link>
                  <span style={{ color: "var(--color-text-muted)" }}>{d.clientName}</span>
                  <span style={{ color: "var(--color-text-muted)" }}>{d.os ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
