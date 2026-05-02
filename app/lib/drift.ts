import "server-only"
import { prisma } from "@/lib/prisma"

// Software drift — Phase 3.
//
// Compares per-host installed software (from inventoryJson.software)
// against the tenant's catalog (Fl_Package.versions). Surfaces:
//   "Chrome 122 (44 hosts), 119 (3 hosts)"
//
// The "3 hosts" cell is the deploy-form pre-population — the off-version
// host id list is the target list for the next "Catch up" deploy.
//
// Today's inventoryJson shape (from mock + planned agent reporting):
//   { software: [{ name, version, source? }, …] }

interface InventorySoftwareEntry {
  name: string
  version?: string | null
}

export interface DriftRow {
  packageId: string
  packageName: string
  os: string
  source: string
  /** Approved version from Fl_PackageVersion. */
  approvedVersion: string | null
  /** Per-version host counts on the fleet. */
  hostCountByVersion: Record<string, number>
  /** Hosts currently NOT at the approved version (for "Catch up"). */
  outdatedDeviceIds: string[]
  /** Hosts at the approved version (for confirmation chip). */
  upToDateDeviceIds: string[]
  /** Hosts NOT installing this package at all. */
  unmanagedDeviceIds: string[]
}

interface DeviceWithInventory {
  id: string
  hostname: string
  os: string | null
  clientName: string
  inventoryJson: string | null
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

function parseSoftwareList(invJson: string | null): InventorySoftwareEntry[] {
  if (!invJson) return []
  try {
    const inv = JSON.parse(invJson) as { software?: InventorySoftwareEntry[] }
    return Array.isArray(inv.software) ? inv.software : []
  } catch {
    return []
  }
}

export async function computeDrift(tenantName: string): Promise<DriftRow[]> {
  const [packages, devices] = await Promise.all([
    prisma.fl_Package.findMany({
      where: { tenantName, archivedAt: null, isApproved: true },
      include: { versions: { orderBy: { createdAt: "desc" } } },
    }),
    prisma.fl_Device.findMany({
      where: { clientName: tenantName, isActive: true },
      select: { id: true, hostname: true, os: true, clientName: true, inventoryJson: true },
    }),
  ])

  return packages
    .filter((p) => devicesMatchOs(p.os, devices).length > 0)
    .map((p) => buildDriftRow(p, devicesMatchOs(p.os, devices)))
}

function devicesMatchOs(packageOs: string, devices: DeviceWithInventory[]): DeviceWithInventory[] {
  if (packageOs === "any") return devices
  return devices.filter((d) => d.os === packageOs)
}

function buildDriftRow(
  pkg: {
    id: string
    name: string
    os: string
    source: string
    versions: { version: string; isApprovedDefault: boolean }[]
  },
  candidates: DeviceWithInventory[],
): DriftRow {
  const approved = pkg.versions.find((v) => v.isApprovedDefault) ?? pkg.versions[0]
  const approvedVersion = approved?.version ?? null
  const hostCountByVersion: Record<string, number> = {}
  const outdated: string[] = []
  const upToDate: string[] = []
  const unmanaged: string[] = []
  const targetName = normalizeName(pkg.name)

  for (const d of candidates) {
    const installed = parseSoftwareList(d.inventoryJson).find((s) => normalizeName(s.name) === targetName)
    if (!installed) {
      unmanaged.push(d.id)
      continue
    }
    const ver = installed.version ?? "unknown"
    hostCountByVersion[ver] = (hostCountByVersion[ver] ?? 0) + 1
    if (approvedVersion && ver === approvedVersion) {
      upToDate.push(d.id)
    } else {
      outdated.push(d.id)
    }
  }

  return {
    packageId: pkg.id,
    packageName: pkg.name,
    os: pkg.os,
    source: pkg.source,
    approvedVersion,
    hostCountByVersion,
    outdatedDeviceIds: outdated,
    upToDateDeviceIds: upToDate,
    unmanagedDeviceIds: unmanaged,
  }
}
