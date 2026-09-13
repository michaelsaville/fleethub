import "server-only"
import { prisma } from "@/lib/prisma"

// ControlR (self-hosted remote control, controlr.pcc2k.com) as a remote-
// session provider — 2026-09-13.
//
// FleetHub owns tenancy, the button, justification and audit; ControlR is
// the engine. We talk to its stable /api/v1 with a server-scoped service
// account (x-api-key, bootstrapped from ~/controlr/docker-compose.yml) and
// hand the operator a single-use logon-token URL that opens the ControlR
// web viewer already signed in as them, scoped to ONE device.
//
// Device identity: ControlR has no idea about FleetHub client names (its
// Customers model is 0.28, still unreleased). We match by hostname — case-
// insensitive, against both the short name and the DNS host name — and
// cache the Guid on Fl_Device.controlrDeviceId. One ControlR tenant for now;
// when a client gets its own ControlR Customer the mapping stays the same.
//
// Env: CONTROLR_URL, CONTROLR_API_KEY, CONTROLR_TENANT_ID. All three unset =
// provider disabled and the RustDesk flow behaves exactly as before.

export class ControlRNotConfigured extends Error {
  constructor() {
    super("ControlR is not configured (CONTROLR_URL / CONTROLR_API_KEY / CONTROLR_TENANT_ID)")
  }
}

function cfg() {
  const url = process.env.CONTROLR_URL?.trim().replace(/\/$/, "")
  const apiKey = process.env.CONTROLR_API_KEY?.trim()
  const tenantId = process.env.CONTROLR_TENANT_ID?.trim()
  if (!url || !apiKey || !tenantId) return null
  return { url, apiKey, tenantId }
}

export function controlrConfigured(): boolean {
  return cfg() !== null
}

export function controlrBaseUrl(): string | null {
  return cfg()?.url ?? null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const c = cfg()
  if (!c) throw new ControlRNotConfigured()
  const res = await fetch(`${c.url}${path}`, {
    ...init,
    headers: {
      "x-api-key": c.apiKey,
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`ControlR ${init?.method ?? "GET"} ${path} → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`)
  }
  return (await res.json()) as T
}

export interface ControlRDevice {
  id: string
  tenantId: string
  name: string
  dnsHostName?: string | null
  alias?: string | null
  isOnline: boolean
  lastSeen: string
  agentVersion: string
  osDescription?: string | null
  currentUsers?: string[]
}

// The device list is small (dozens) and the API streams the whole tenant;
// cache it briefly so a page load + a click don't fetch it twice.
let deviceCache: { at: number; devices: ControlRDevice[] } | null = null
const DEVICE_CACHE_MS = 30_000

export async function listControlRDevices(force = false): Promise<ControlRDevice[]> {
  if (!force && deviceCache && Date.now() - deviceCache.at < DEVICE_CACHE_MS) return deviceCache.devices
  const devices = await api<ControlRDevice[]>("/api/v1/devices")
  deviceCache = { at: Date.now(), devices }
  return devices
}

export async function getControlRDevice(id: string): Promise<ControlRDevice | null> {
  try {
    return await api<ControlRDevice>(`/api/v1/devices/${id}`)
  } catch (e) {
    if (e instanceof Error && /HTTP 404/.test(e.message)) return null
    throw e
  }
}

function norm(h: string | null | undefined): string {
  return (h ?? "").trim().toLowerCase().split(".")[0]
}

/** Resolve (and cache) the ControlR device for a FleetHub device. Returns
 *  null when ControlR isn't configured or nothing matches. Never throws on
 *  a ControlR outage — the launcher just shows "not reachable". */
export async function resolveControlRDeviceId(device: {
  id: string
  hostname: string
  controlrDeviceId: string | null
}): Promise<{ controlrDeviceId: string; device: ControlRDevice | null } | null> {
  if (!controlrConfigured()) return null
  try {
    if (device.controlrDeviceId) {
      const d = await getControlRDevice(device.controlrDeviceId)
      if (d) return { controlrDeviceId: d.id, device: d }
      // Stale mapping (device re-enrolled in ControlR) — fall through and re-match.
    }
    const want = norm(device.hostname)
    if (!want) return null
    const all = await listControlRDevices()
    const hits = all.filter((d) => norm(d.name) === want || norm(d.dnsHostName) === want)
    if (hits.length !== 1) return null // ambiguous or absent — don't guess
    await prisma.fl_Device.update({ where: { id: device.id }, data: { controlrDeviceId: hits[0].id } })
    return { controlrDeviceId: hits[0].id, device: hits[0] }
  } catch {
    return null
  }
}

/** ControlR turns the correlation id into an Identity username
 *  (`ext-<id>`) and a synthetic email (`ext-<id>@controlr.local`), so it
 *  must be identity-safe: letters, digits, dot, dash only. A colon or a
 *  second "@" makes user creation fail with an opaque HTTP 500 ("Failed to
 *  create external user") — seen live 2026-09-13. Stable per operator. */
export function controlrCorrelationId(operatorEmail: string): string {
  const slug = operatorEmail.trim().toLowerCase().replace(/@/g, ".at.").replace(/[^a-z0-9.-]+/g, "-")
  return `fleethub-${slug}`.slice(0, 120)
}

export interface LogonTokenResult {
  deviceAccessUrl: string
  expiresAt: string
}

/** Mint a single-use logon token that opens ControlR's viewer for ONE
 *  device as the named FleetHub operator. `sessionCorrelationId` is our
 *  Fl_RemoteSession id so both audit trails line up. */
export async function createControlRLogonToken(args: {
  controlrDeviceId: string
  operatorEmail: string
  operatorName: string | null
  sessionId: string
  expirationMinutes: number
}): Promise<LogonTokenResult> {
  const c = cfg()
  if (!c) throw new ControlRNotConfigured()
  const r = await api<{ deviceAccessUrl: string; expiresAt: string; token: string }>(
    "/api/v1/logon-tokens/external",
    {
      method: "POST",
      body: JSON.stringify({
        deviceId: args.controlrDeviceId,
        tenantId: c.tenantId,
        userCorrelationId: controlrCorrelationId(args.operatorEmail),
        userDisplayName: args.operatorName ?? args.operatorEmail,
        sessionCorrelationId: args.sessionId,
        expirationMinutes: args.expirationMinutes,
      }),
    },
  )
  return { deviceAccessUrl: r.deviceAccessUrl, expiresAt: r.expiresAt }
}
