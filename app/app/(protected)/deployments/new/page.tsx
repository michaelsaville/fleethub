import Link from "next/link"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import DeploymentForm from "./DeploymentForm"

export const dynamic = "force-dynamic"

export default async function NewDeploymentPage({
  searchParams,
}: {
  searchParams: Promise<{ packageId?: string; targets?: string; ring?: string }>
}) {
  const sp = await searchParams

  // Available packages (approved + not archived) — group by tenant.
  const packages = await prisma.fl_Package.findMany({
    where: { archivedAt: null, isApproved: true },
    include: { versions: { orderBy: { createdAt: "desc" } } },
    orderBy: [{ tenantName: "asc" }, { name: "asc" }],
  })

  // All non-archived rings, grouped by tenant.
  const rings = await prisma.fl_DeployRing.findMany({
    where: { archivedAt: null },
    orderBy: [{ tenantName: "asc" }, { name: "asc" }],
  })

  // All active devices for the target picker.
  const devices = await prisma.fl_Device.findMany({
    where: { isActive: true },
    select: {
      id: true,
      hostname: true,
      clientName: true,
      os: true,
      role: true,
      isOnline: true,
      maintenanceMode: true,
    },
    orderBy: [{ clientName: "asc" }, { hostname: "asc" }],
  })

  const defaultTargets = sp.targets ? sp.targets.split(",").filter(Boolean) : []

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              New deployment
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: "640px" }}>
              Pick a package, version, and target set. Defaults to dry-run; flip
              to apply when ready. Real agent dispatch is mock-driven in v1 — use
              the simulate buttons on the live monitor to walk the flow.
            </p>
          </div>
          <Link href="/deployments" style={{ fontSize: 12, color: "var(--color-text-secondary)", textDecoration: "none" }}>
            ← All deployments
          </Link>
        </header>

        <DeploymentForm
          packages={packages.map((p) => ({
            id: p.id,
            name: p.name,
            tenantName: p.tenantName,
            os: p.os,
            source: p.source,
            rebootPolicy: p.rebootPolicy,
            versions: p.versions.map((v) => ({
              id: v.id,
              version: v.version,
              isApprovedDefault: v.isApprovedDefault,
            })),
          }))}
          rings={rings.map((r) => ({
            id: r.id,
            name: r.name,
            tenantName: r.tenantName,
            isDefault: r.isDefault,
          }))}
          devices={devices}
          defaultPackageId={sp.packageId ?? null}
          defaultRingId={sp.ring ?? null}
          defaultTargetIds={defaultTargets}
        />
      </div>
    </AppShell>
  )
}
