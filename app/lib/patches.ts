import "server-only"
import { listDevices } from "@/lib/devices"
import type { DeviceRow } from "@/lib/devices"

/**
 * Phase 4 patch-management surface, mock-aware. The agent's
 * inventory snapshot only carries aggregate per-host counts
 * (`patches.pending`, `patches.failed`, `patches.lastChecked`),
 * so every helper here is a fold over those — no fake per-KB
 * data. Real Phase 4 will introduce a separate `Fl_PatchEntry`
 * table; the page shape stays the same.
 */

export interface FleetPatchPosture {
  devices: number
  fullyPatched: number
  withPending: number
  withFailed: number
  staleCheck: number
  pendingTotal: number
  failedTotal: number
  oldestCheckIso: string | null
}

const STALE_DAYS = 7
const STALE_MS = STALE_DAYS * 86_400_000

function isStale(d: DeviceRow, now: number): boolean {
  const last = d.inventory?.patches.lastChecked
  if (!last) return true
  return now - new Date(last).getTime() > STALE_MS
}

export async function getFleetPatchPosture(): Promise<FleetPatchPosture> {
  const { rows } = await listDevices()
  const now = Date.now()
  let pendingTotal = 0
  let failedTotal = 0
  let withPending = 0
  let withFailed = 0
  let staleCheck = 0
  let fullyPatched = 0
  let oldestMs = Number.POSITIVE_INFINITY
  for (const d of rows) {
    const p = d.inventory?.patches
    const pending = p?.pending ?? 0
    const failed  = p?.failed ?? 0
    pendingTotal += pending
    failedTotal  += failed
    if (pending > 0) withPending++
    if (failed > 0) withFailed++
    if (isStale(d, now)) staleCheck++
    if (pending === 0 && failed === 0) fullyPatched++
    if (p?.lastChecked) {
      const t = new Date(p.lastChecked).getTime()
      if (t < oldestMs) oldestMs = t
    }
  }
  return {
    devices: rows.length,
    fullyPatched,
    withPending,
    withFailed,
    staleCheck,
    pendingTotal,
    failedTotal,
    oldestCheckIso: Number.isFinite(oldestMs) ? new Date(oldestMs).toISOString() : null,
  }
}

export interface ClientPatchRollup {
  clientName: string
  deviceCount: number
  fullyPatched: number
  pendingTotal: number
  failedTotal: number
  staleCheck: number
  patchedPct: number
}

export async function getPerClientPatchRollup(): Promise<ClientPatchRollup[]> {
  const { rows } = await listDevices()
  const now = Date.now()
  const byClient = new Map<string, ClientPatchRollup>()
  for (const d of rows) {
    let row = byClient.get(d.clientName)
    if (!row) {
      row = {
        clientName: d.clientName,
        deviceCount: 0,
        fullyPatched: 0,
        pendingTotal: 0,
        failedTotal: 0,
        staleCheck: 0,
        patchedPct: 0,
      }
      byClient.set(d.clientName, row)
    }
    const p = d.inventory?.patches
    row.deviceCount++
    row.pendingTotal += p?.pending ?? 0
    row.failedTotal  += p?.failed ?? 0
    if ((p?.pending ?? 0) === 0 && (p?.failed ?? 0) === 0) row.fullyPatched++
    if (isStale(d, now)) row.staleCheck++
  }
  for (const r of byClient.values()) {
    r.patchedPct = r.deviceCount === 0 ? 0 : Math.round((r.fullyPatched / r.deviceCount) * 100)
  }
  return [...byClient.values()].sort((a, b) =>
    a.patchedPct - b.patchedPct ||
    b.failedTotal - a.failedTotal ||
    b.pendingTotal - a.pendingTotal ||
    a.clientName.localeCompare(b.clientName),
  )
}

export interface DevicePatchRow {
  device: DeviceRow
  pending: number
  failed: number
  lastCheckedIso: string | null
  lastCheckedAgeDays: number | null
}

/**
 * Devices ranked worst-first: failed > pending > stale check-in.
 * The list is bounded to keep the Phase 4 rollout queue scannable
 * — caller asks for as many as fit on the page.
 */
export async function getDevicesNeedingPatches(limit = 12): Promise<DevicePatchRow[]> {
  const { rows } = await listDevices()
  const now = Date.now()
  const flagged: DevicePatchRow[] = []
  for (const d of rows) {
    const p = d.inventory?.patches
    const pending = p?.pending ?? 0
    const failed  = p?.failed ?? 0
    if (pending === 0 && failed === 0) continue
    const lastCheckedIso = p?.lastChecked ?? null
    const ageDays = lastCheckedIso
      ? Math.floor((now - new Date(lastCheckedIso).getTime()) / 86_400_000)
      : null
    flagged.push({ device: d, pending, failed, lastCheckedIso, lastCheckedAgeDays: ageDays })
  }
  flagged.sort((a, b) =>
    b.failed - a.failed ||
    b.pending - a.pending ||
    (b.lastCheckedAgeDays ?? 0) - (a.lastCheckedAgeDays ?? 0),
  )
  return flagged.slice(0, limit)
}

export interface StaleCheckInRow {
  device: DeviceRow
  lastCheckedIso: string | null
  ageDays: number | null
}

export async function getStaleCheckIns(thresholdDays = STALE_DAYS): Promise<StaleCheckInRow[]> {
  const { rows } = await listDevices()
  const now = Date.now()
  const out: StaleCheckInRow[] = []
  for (const d of rows) {
    const p = d.inventory?.patches
    const lastCheckedIso = p?.lastChecked ?? null
    const ageMs = lastCheckedIso ? now - new Date(lastCheckedIso).getTime() : null
    const ageDays = ageMs == null ? null : Math.floor(ageMs / 86_400_000)
    if (ageDays == null || ageDays >= thresholdDays) out.push({ device: d, lastCheckedIso, ageDays })
  }
  return out
    .sort((a, b) => (b.ageDays ?? Number.MAX_SAFE_INTEGER) - (a.ageDays ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 12)
}
