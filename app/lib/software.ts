import "server-only"
import { listDevices } from "@/lib/devices"
import type { DeviceRow } from "@/lib/devices"

/**
 * Phase 3 software-deployment surface, mock-aware. The agent's
 * inventory snapshot carries `software.totalInstalled` (count) and
 * a `software.sample` (subset of names — the agent picks notable
 * apps; real impl will stream the full list to a separate table).
 * Helpers fold over those; nothing here invents data.
 */

export interface FleetSoftwarePosture {
  devices: number
  totalInstalls: number
  uniqueAppsSeen: number
  avgPerHost: number
}

export async function getFleetSoftwarePosture(): Promise<FleetSoftwarePosture> {
  const { rows } = await listDevices()
  const seen = new Set<string>()
  let totalInstalls = 0
  for (const d of rows) {
    totalInstalls += d.inventory?.software.totalInstalled ?? 0
    for (const name of d.inventory?.software.sample ?? []) seen.add(name)
  }
  return {
    devices: rows.length,
    totalInstalls,
    uniqueAppsSeen: seen.size,
    avgPerHost: rows.length === 0 ? 0 : Math.round(totalInstalls / rows.length),
  }
}

export interface TopAppRow {
  name: string
  hostCount: number
  pct: number
}

/**
 * Approximate fleet-wide app prevalence from the per-host `sample`.
 * It's an undercount (sample is a subset) but the ranking is the
 * shape the Phase 3 deployment picker will use.
 */
export async function getTopApps(limit = 12): Promise<TopAppRow[]> {
  const { rows } = await listDevices()
  if (rows.length === 0) return []
  const counts = new Map<string, number>()
  for (const d of rows) {
    for (const name of d.inventory?.software.sample ?? []) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  const total = rows.length
  return [...counts.entries()]
    .map(([name, hostCount]) => ({
      name,
      hostCount,
      pct: Math.round((hostCount / total) * 100),
    }))
    .sort((a, b) => b.hostCount - a.hostCount || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export interface ClientSoftwareRollup {
  clientName: string
  deviceCount: number
  totalInstalls: number
  avgPerHost: number
}

export async function getPerClientSoftware(): Promise<ClientSoftwareRollup[]> {
  const { rows } = await listDevices()
  const byClient = new Map<string, ClientSoftwareRollup>()
  for (const d of rows) {
    let row = byClient.get(d.clientName)
    if (!row) {
      row = { clientName: d.clientName, deviceCount: 0, totalInstalls: 0, avgPerHost: 0 }
      byClient.set(d.clientName, row)
    }
    row.deviceCount++
    row.totalInstalls += d.inventory?.software.totalInstalled ?? 0
  }
  for (const r of byClient.values()) {
    r.avgPerHost = r.deviceCount === 0 ? 0 : Math.round(r.totalInstalls / r.deviceCount)
  }
  return [...byClient.values()].sort((a, b) =>
    b.totalInstalls - a.totalInstalls || a.clientName.localeCompare(b.clientName),
  )
}

export interface HeavyHostRow {
  device: DeviceRow
  totalInstalled: number
}

export async function getHeavyHosts(limit = 10): Promise<HeavyHostRow[]> {
  const { rows } = await listDevices()
  return rows
    .map((d) => ({ device: d, totalInstalled: d.inventory?.software.totalInstalled ?? 0 }))
    .filter((r) => r.totalInstalled > 0)
    .sort((a, b) => b.totalInstalled - a.totalInstalled)
    .slice(0, limit)
}
