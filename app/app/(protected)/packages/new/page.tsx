import AppShell from "@/components/AppShell"
import Link from "next/link"
import NewPackageForm from "./NewPackageForm"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function NewPackagePage() {
  // Tenants come from existing Fl_Device.clientName values; create a Fl_Tenant
  // row on first reference would be Phase 3 step 1+ refinement. For now,
  // use distinct clientName values as the tenant picker.
  const distinctTenants = await prisma.fl_Device.findMany({
    select: { clientName: true },
    distinct: ["clientName"],
    orderBy: { clientName: "asc" },
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4 }}>
              New package
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0, maxWidth: 640 }}>
              Add a winget / choco / brew package by id, or upload a custom MSI / PKG / DEB.
              Custom uploads parse vendor metadata + suggest silent install args (mock-parse in v1; real parse via msiinfo lands later).
            </p>
          </div>
          <Link href="/packages" style={{ fontSize: 12, color: "var(--color-text-secondary)", textDecoration: "none" }}>
            ← Catalog
          </Link>
        </header>

        <NewPackageForm tenants={distinctTenants.map((t) => t.clientName)} />
      </div>
    </AppShell>
  )
}
