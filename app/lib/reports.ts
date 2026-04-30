import "server-only"
import { listAlerts } from "@/lib/alerts"
import { listClients } from "@/lib/clients"
import { listDevices, mockMode } from "@/lib/devices"
import type { DeviceRow } from "@/lib/devices"

/**
 * Cross-cut reporting helpers — derive the Phase 5 reports from
 * inventory snapshots already on every Fl_Device row. Mock-aware.
 *
 * Every report returns plain data shapes (not React); the page
 * component renders them. That way export-to-CSV (Phase 5+) can
 * reuse the same shapes.
 */

export interface ComplianceRow {
  clientName: string
  deviceCount: number
  patchedCount: number    // 0 pending updates
  onlineCount: number
  alertFreeCount: number  // 0 open alerts on the host
  patchedPct: number
  onlinePct: number
  alertFreePct: number
}

export async function getCompliance(): Promise<ComplianceRow[]> {
  const [{ rows: devices }, { rows: alerts }] = await Promise.all([
    listDevices(),
    listAlerts({ state: "all" }),
  ])
  const openByDevice = new Map<string, number>()
  for (const a of alerts) {
    if (a.state !== "open" || !a.deviceId) continue
    openByDevice.set(a.deviceId, (openByDevice.get(a.deviceId) ?? 0) + 1)
  }
  const byClient = new Map<string, ComplianceRow>()
  for (const d of devices) {
    let row = byClient.get(d.clientName)
    if (!row) {
      row = {
        clientName: d.clientName,
        deviceCount: 0,
        patchedCount: 0,
        onlineCount: 0,
        alertFreeCount: 0,
        patchedPct: 0,
        onlinePct: 0,
        alertFreePct: 0,
      }
      byClient.set(d.clientName, row)
    }
    row.deviceCount++
    if ((d.inventory?.patches.pending ?? 0) === 0) row.patchedCount++
    if (d.isOnline) row.onlineCount++
    if ((openByDevice.get(d.id) ?? 0) === 0) row.alertFreeCount++
  }
  for (const r of byClient.values()) {
    r.patchedPct   = r.deviceCount === 0 ? 0 : Math.round((r.patchedCount   / r.deviceCount) * 100)
    r.onlinePct    = r.deviceCount === 0 ? 0 : Math.round((r.onlineCount    / r.deviceCount) * 100)
    r.alertFreePct = r.deviceCount === 0 ? 0 : Math.round((r.alertFreeCount / r.deviceCount) * 100)
  }
  return [...byClient.values()].sort((a, b) =>
    a.patchedPct - b.patchedPct ||         // worst-patched first
    b.deviceCount - a.deviceCount ||
    a.clientName.localeCompare(b.clientName),
  )
}

export interface OsDistributionRow {
  family: "windows" | "linux" | "darwin" | "unknown"
  count: number
  pct: number
  versions: Array<{ version: string; count: number }>
}

export async function getOsDistribution(): Promise<OsDistributionRow[]> {
  const { rows: devices } = await listDevices()
  const total = devices.length
  const families = new Map<string, OsDistributionRow>()
  for (const d of devices) {
    const family = (d.os ?? "unknown") as OsDistributionRow["family"]
    let row = families.get(family)
    if (!row) {
      row = { family, count: 0, pct: 0, versions: [] }
      families.set(family, row)
    }
    row.count++
    const v = d.osVersion ?? "(unknown)"
    const existing = row.versions.find((x) => x.version === v)
    if (existing) existing.count++
    else row.versions.push({ version: v, count: 1 })
  }
  for (const row of families.values()) {
    row.pct = total === 0 ? 0 : Math.round((row.count / total) * 100)
    row.versions.sort((a, b) => b.count - a.count)
  }
  return [...families.values()].sort((a, b) => b.count - a.count)
}

export interface EolHostRow {
  device: DeviceRow
  reason: string
}

/**
 * Identify hosts likely past or near support end-of-life. The
 * "rules" are intentionally conservative — they err on flagging
 * rather than missing. Real Phase 5 will bring real CPE feed lookups.
 */
export async function getEolHosts(): Promise<EolHostRow[]> {
  const { rows: devices } = await listDevices()
  const flagged: EolHostRow[] = []
  for (const d of devices) {
    const v = (d.osVersion ?? "").toLowerCase()
    if (v.includes("windows 10") && v.includes("22h2")) {
      flagged.push({ device: d, reason: "Win 10 22H2 — support ends Oct 2025" })
    } else if (v.includes("windows 10")) {
      flagged.push({ device: d, reason: "Win 10 (any) — support ends Oct 2025" })
    } else if (v.includes("server 2019") || v.includes("server 2016")) {
      flagged.push({ device: d, reason: "Mainstream support ended; ESU window only" })
    } else if (v.includes("ubuntu") && /2[0-3]\.\d+/.test(v) && !v.includes("lts")) {
      flagged.push({ device: d, reason: "Non-LTS Ubuntu — short support window" })
    }
  }
  return flagged
}

export interface LifecycleRow {
  device: DeviceRow
  ageYears: number
}

/**
 * Hardware lifecycle — oldest devices first. Caller decides how
 * many to show; default 10 covers most decks without being noisy.
 */
export async function getLifecycle(limit = 10): Promise<LifecycleRow[]> {
  const { rows: devices } = await listDevices()
  const now = new Date()
  const rows = devices
    .filter((d) => d.inventory?.hardware.purchaseDate)
    .map((d) => {
      const purchased = new Date(d.inventory!.hardware.purchaseDate)
      const ms = now.getTime() - purchased.getTime()
      return { device: d, ageYears: +(ms / (365.25 * 24 * 3600 * 1000)).toFixed(1) }
    })
  rows.sort((a, b) => b.ageYears - a.ageYears)
  return rows.slice(0, limit)
}

export interface PressureRow {
  device: DeviceRow
  metric: "disk" | "ram" | "boot"
  value: number | string
}

export async function getDiskPressure(threshold = 85): Promise<PressureRow[]> {
  const { rows: devices } = await listDevices()
  return devices
    .filter((d) => (d.inventory?.health.diskPct ?? 0) >= threshold)
    .map((d) => ({ device: d, metric: "disk" as const, value: d.inventory!.health.diskPct }))
    .sort((a, b) => (b.value as number) - (a.value as number))
}

export async function getMemoryPressure(threshold = 80): Promise<PressureRow[]> {
  const { rows: devices } = await listDevices()
  return devices
    .filter((d) => (d.inventory?.health.ramPct ?? 0) >= threshold)
    .map((d) => ({ device: d, metric: "ram" as const, value: d.inventory!.health.ramPct }))
    .sort((a, b) => (b.value as number) - (a.value as number))
}

export async function getStaleBoots(thresholdDays = 30): Promise<PressureRow[]> {
  const { rows: devices } = await listDevices()
  const now = Date.now()
  const out: PressureRow[] = []
  for (const d of devices) {
    if (!d.inventory?.os.lastBootAt) continue
    const ageDays = Math.floor((now - new Date(d.inventory.os.lastBootAt).getTime()) / 86_400_000)
    if (ageDays >= thresholdDays) {
      out.push({ device: d, metric: "boot", value: `${ageDays} days` })
    }
  }
  return out.sort((a, b) => parseInt(String(b.value)) - parseInt(String(a.value)))
}

/**
 * Top-level fleet snapshot — the numbers shown on the report
 * landing page. Wraps the existing helpers so the page itself stays
 * declarative.
 */
export interface FleetSnapshot {
  clients: number
  devices: number
  online: number
  patched: number
  alertFree: number
  isMock: boolean
}

export async function getFleetSnapshot(): Promise<FleetSnapshot> {
  const [clients, { rows: devices }, { rows: alerts }, isMock] = await Promise.all([
    listClients(),
    listDevices(),
    listAlerts({ state: "all" }),
    mockMode(),
  ])
  const openByDevice = new Set(alerts.filter((a) => a.state === "open").map((a) => a.deviceId).filter(Boolean) as string[])
  return {
    clients: clients.length,
    devices: devices.length,
    online: devices.filter((d) => d.isOnline).length,
    patched: devices.filter((d) => (d.inventory?.patches.pending ?? 0) === 0).length,
    alertFree: devices.filter((d) => !openByDevice.has(d.id)).length,
    isMock,
  }
}
