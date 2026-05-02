import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import RunScriptForm from "./RunScriptForm"

export const dynamic = "force-dynamic"

export default async function RunScriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ targetDeviceId?: string }>
}) {
  const { id } = await params
  const sp = await searchParams

  const script = await prisma.fl_Script.findUnique({ where: { id } })
  if (!script || !script.isActive) notFound()

  // Devices for the picker — only those NOT in maintenance mode show up
  // as actionable (maintenance is highlighted but greyed out).
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

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 880 }}>
        <header>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
            <Link href={`/scripts/${script.id}`} style={{ color: "inherit", textDecoration: "none" }}>← {script.name}</Link>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
            Run “{script.name}”
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: "4px 0 0", maxWidth: 640 }}>
            Pick a target host and run. Defaults to dry-run; uncheck to apply
            (extra confirmation when off). Real agent dispatch is mock-driven
            in v1 — use the simulate panel on the run viewer to walk it.
          </p>
        </header>

        <RunScriptForm
          script={{
            id: script.id,
            name: script.name,
            shell: script.shell,
            dryRunCapable: script.dryRunCapable,
            requiresSignature: script.requiresSignature,
          }}
          devices={devices}
          defaultDeviceId={sp.targetDeviceId ?? null}
        />
      </div>
    </AppShell>
  )
}
