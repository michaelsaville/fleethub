import "server-only"

/**
 * Synthetic fleet for designing the /devices and /devices/[id] UIs
 * before the PCC2K-Agent (see docs/AGENT-PROTOCOL.md) ships and real
 * `Fl_Device` rows start arriving.
 *
 * `lib/devices.ts` falls back to this set ONLY when the live table is
 * empty, so the moment the first agent enrolls the mock disappears.
 *
 * Structurally identical to a `Fl_Device` row + the inventory-snapshot
 * shape inventory.report will eventually populate — same field names,
 * same JSON layout. Treat this file as the contract the agent must
 * match. If it changes here, the agent collector changes too.
 */

import type { ActivityItem } from "@/components/ActivityFeed"
import type { DeviceAlert, DeviceRow, InventorySnapshot } from "@/lib/devices"
import { relativeLastSeen } from "./devices-time"

interface AlertSeed {
  kind: string
  severity: "info" | "warn" | "critical"
  title: string
  detail?: string
  minutesAgo: number
  state?: "open" | "ack" | "resolved"
}

interface Seed {
  id: string
  clientName: string
  hostname: string
  os: "windows" | "linux" | "darwin"
  osVersion: string
  role: string
  ipAddress: string
  isOnline: boolean
  lastSeenMinutesAgo: number
  alertCount: number
  alerts?: AlertSeed[]
  inventory: InventorySnapshot
}

const seeds: Seed[] = [
  {
    id: "mk-dev-rx-clinical-01",
    clientName: "Riverside Family Clinic",
    hostname: "rx-clinical-01",
    os: "windows",
    osVersion: "Windows 11 Pro 23H2 (10.0.22631.4317)",
    role: "workstation",
    ipAddress: "10.41.2.18",
    isOnline: true,
    lastSeenMinutesAgo: 1,
    alertCount: 0,
    inventory: {
      hardware: {
        manufacturer: "Lenovo",
        model: "ThinkCentre M70q Gen3",
        serial: "MJ-1F4Z02BQ",
        cpu: "Intel i5-12400T @ 1.8GHz (6c/12t)",
        ramGb: 16,
        diskGb: 512,
        diskFreeGb: 287,
        biosVersion: "M3KKT2DA",
        biosDate: "2024-09-12",
        purchaseDate: "2024-10-04",
      },
      os: {
        family: "windows",
        version: "Windows 11 Pro 23H2",
        build: "10.0.22631.4317",
        installedAt: "2024-10-08T14:22:10Z",
        lastBootAt: "2026-04-29T07:11:42Z",
        timezone: "America/New_York",
      },
      patches: { lastChecked: "2026-04-30T03:14:00Z", pending: 2, failed: 0 },
      software: { totalInstalled: 87, sample: ["Microsoft 365 Apps", "Chrome 134", "Adobe Reader DC", "Epic Hyperdrive 9.4"] },
      health: { cpu7d: 18, ramPct: 42, diskPct: 44 },
    },
  },
  {
    id: "mk-dev-rx-clinical-02",
    clientName: "Riverside Family Clinic",
    hostname: "rx-clinical-02",
    os: "windows",
    osVersion: "Windows 11 Pro 23H2 (10.0.22631.4317)",
    role: "workstation",
    ipAddress: "10.41.2.19",
    isOnline: true,
    lastSeenMinutesAgo: 3,
    alertCount: 1,
    alerts: [
      {
        kind: "disk.high",
        severity: "warn",
        title: "C: drive 92% full (38 GB free)",
        detail: "Threshold: 85%. Cleanup recommended; user is hitting it daily.",
        minutesAgo: 22,
      },
    ],
    inventory: {
      hardware: {
        manufacturer: "Lenovo",
        model: "ThinkCentre M70q Gen3",
        serial: "MJ-1F4Z02C1",
        cpu: "Intel i5-12400T @ 1.8GHz (6c/12t)",
        ramGb: 16,
        diskGb: 512,
        diskFreeGb: 38,
        biosVersion: "M3KKT2DA",
        biosDate: "2024-09-12",
        purchaseDate: "2024-10-04",
      },
      os: {
        family: "windows",
        version: "Windows 11 Pro 23H2",
        build: "10.0.22631.4317",
        installedAt: "2024-10-08T15:01:41Z",
        lastBootAt: "2026-04-12T08:22:10Z",
        timezone: "America/New_York",
      },
      patches: { lastChecked: "2026-04-30T03:14:00Z", pending: 4, failed: 0 },
      software: { totalInstalled: 91, sample: ["Microsoft 365 Apps", "Chrome 134", "Adobe Reader DC", "Epic Hyperdrive 9.4"] },
      health: { cpu7d: 22, ramPct: 67, diskPct: 92 },
    },
  },
  {
    id: "mk-dev-rx-dc-01",
    clientName: "Riverside Family Clinic",
    hostname: "rx-dc-01",
    os: "windows",
    osVersion: "Windows Server 2022 Standard (10.0.20348.2655)",
    role: "DC",
    ipAddress: "10.41.1.10",
    isOnline: true,
    lastSeenMinutesAgo: 0,
    alertCount: 0,
    inventory: {
      hardware: {
        manufacturer: "Dell",
        model: "PowerEdge T350",
        serial: "DL-PT350-9X12K",
        cpu: "Intel Xeon E-2334 @ 3.4GHz (4c/8t)",
        ramGb: 64,
        diskGb: 2048,
        diskFreeGb: 1411,
        biosVersion: "2.16.0",
        biosDate: "2024-11-04",
        purchaseDate: "2023-06-10",
      },
      os: {
        family: "windows",
        version: "Windows Server 2022 Standard",
        build: "10.0.20348.2655",
        installedAt: "2023-06-22T16:11:01Z",
        lastBootAt: "2026-03-14T02:00:00Z",
        timezone: "America/New_York",
      },
      patches: { lastChecked: "2026-04-30T02:00:00Z", pending: 0, failed: 0 },
      software: { totalInstalled: 42, sample: ["Active Directory DS", "DNS Server", "DHCP Server"] },
      health: { cpu7d: 9, ramPct: 31, diskPct: 31 },
    },
  },
  {
    id: "mk-dev-rx-fs-01",
    clientName: "Riverside Family Clinic",
    hostname: "rx-fs-01",
    os: "windows",
    osVersion: "Windows Server 2019 Standard (10.0.17763.6293)",
    role: "file server",
    ipAddress: "10.41.1.20",
    isOnline: false,
    lastSeenMinutesAgo: 142,
    alertCount: 2,
    alerts: [
      {
        kind: "agent.disconnected",
        severity: "critical",
        title: "Agent offline for 2h 22m",
        detail: "Last heartbeat 142 minutes ago; expected every 30s.",
        minutesAgo: 130,
      },
      {
        kind: "patch.failed",
        severity: "warn",
        title: "KB5036893 install failed (exit 0x80073712)",
        detail: "Servicing stack corruption. SFC + DISM scan recommended.",
        minutesAgo: 4_340,
      },
    ],
    inventory: {
      hardware: {
        manufacturer: "HP",
        model: "ProLiant ML30 Gen10",
        serial: "HP-ML30-3J911A",
        cpu: "Intel Xeon E-2224 @ 3.4GHz (4c/4t)",
        ramGb: 32,
        diskGb: 4096,
        diskFreeGb: 1180,
        biosVersion: "U54 v2.78",
        biosDate: "2024-04-22",
        purchaseDate: "2020-11-15",
      },
      os: {
        family: "windows",
        version: "Windows Server 2019 Standard",
        build: "10.0.17763.6293",
        installedAt: "2020-12-02T11:45:00Z",
        lastBootAt: "2026-04-22T03:00:00Z",
        timezone: "America/New_York",
      },
      patches: { lastChecked: "2026-04-25T02:00:00Z", pending: 7, failed: 1 },
      software: { totalInstalled: 38, sample: ["File Server role", "Veeam Agent", "Defender for Servers"] },
      health: { cpu7d: 12, ramPct: 48, diskPct: 71 },
    },
  },
  {
    id: "mk-dev-bd-laptop-04",
    clientName: "Bridgeway Dental",
    hostname: "bd-laptop-04",
    os: "windows",
    osVersion: "Windows 11 Pro 24H2 (10.0.26100.2161)",
    role: "laptop",
    ipAddress: "10.20.5.41",
    isOnline: true,
    lastSeenMinutesAgo: 4,
    alertCount: 0,
    inventory: {
      hardware: {
        manufacturer: "HP",
        model: "EliteBook 845 G10",
        serial: "HP-EB845-2C7K1",
        cpu: "AMD Ryzen 7 PRO 7840U (8c/16t)",
        ramGb: 32,
        diskGb: 1024,
        diskFreeGb: 612,
        biosVersion: "V92 v01.06.00",
        biosDate: "2025-01-09",
        purchaseDate: "2024-08-19",
      },
      os: {
        family: "windows",
        version: "Windows 11 Pro 24H2",
        build: "10.0.26100.2161",
        installedAt: "2024-08-21T09:00:14Z",
        lastBootAt: "2026-04-30T06:48:30Z",
        timezone: "America/New_York",
      },
      patches: { lastChecked: "2026-04-30T03:14:00Z", pending: 1, failed: 0 },
      software: { totalInstalled: 64, sample: ["Microsoft 365 Apps", "Chrome 134", "Dentrix G7"] },
      health: { cpu7d: 14, ramPct: 38, diskPct: 40 },
    },
  },
  {
    id: "mk-dev-bd-front-01",
    clientName: "Bridgeway Dental",
    hostname: "bd-front-01",
    os: "windows",
    osVersion: "Windows 10 Pro 22H2 (10.0.19045.4894)",
    role: "workstation",
    ipAddress: "10.20.5.18",
    isOnline: true,
    lastSeenMinutesAgo: 2,
    alertCount: 1,
    alerts: [
      {
        kind: "memory.pressure",
        severity: "warn",
        title: "Sustained RAM utilization 84% (7d avg)",
        detail: "8 GB on a Dentrix workstation is undersized; consider upgrade.",
        minutesAgo: 220,
      },
    ],
    inventory: {
      hardware: {
        manufacturer: "Dell",
        model: "OptiPlex 3080",
        serial: "DL-OP3080-72KQ1",
        cpu: "Intel i5-10500 @ 3.1GHz (6c/12t)",
        ramGb: 8,
        diskGb: 256,
        diskFreeGb: 78,
        biosVersion: "2.31.0",
        biosDate: "2024-08-12",
        purchaseDate: "2021-02-08",
      },
      os: {
        family: "windows",
        version: "Windows 10 Pro 22H2",
        build: "10.0.19045.4894",
        installedAt: "2021-02-15T10:14:22Z",
        lastBootAt: "2026-04-29T08:01:00Z",
        timezone: "America/New_York",
      },
      patches: { lastChecked: "2026-04-30T03:14:00Z", pending: 3, failed: 0 },
      software: { totalInstalled: 71, sample: ["Microsoft 365 Apps", "Chrome 134", "Dentrix G7", "Sirona SiDexis"] },
      health: { cpu7d: 31, ramPct: 84, diskPct: 70 },
    },
  },
  {
    id: "mk-dev-bd-server-01",
    clientName: "Bridgeway Dental",
    hostname: "bd-server-01",
    os: "windows",
    osVersion: "Windows Server 2022 Standard (10.0.20348.2655)",
    role: "DC",
    ipAddress: "10.20.1.10",
    isOnline: true,
    lastSeenMinutesAgo: 1,
    alertCount: 0,
    inventory: {
      hardware: {
        manufacturer: "Dell",
        model: "PowerEdge R350",
        serial: "DL-PR350-X4M2N",
        cpu: "Intel Xeon E-2334 @ 3.4GHz (4c/8t)",
        ramGb: 32,
        diskGb: 1024,
        diskFreeGb: 690,
        biosVersion: "2.16.0",
        biosDate: "2024-11-04",
        purchaseDate: "2023-09-22",
      },
      os: {
        family: "windows",
        version: "Windows Server 2022 Standard",
        build: "10.0.20348.2655",
        installedAt: "2023-10-04T13:00:00Z",
        lastBootAt: "2026-04-12T02:30:00Z",
        timezone: "America/New_York",
      },
      patches: { lastChecked: "2026-04-30T02:00:00Z", pending: 0, failed: 0 },
      software: { totalInstalled: 36, sample: ["Active Directory DS", "DNS Server", "Dentrix Server"] },
      health: { cpu7d: 11, ramPct: 28, diskPct: 33 },
    },
  },
  {
    id: "mk-dev-bd-printer-svc",
    clientName: "Bridgeway Dental",
    hostname: "bd-printer-svc",
    os: "linux",
    osVersion: "Ubuntu Server 22.04.5 LTS",
    role: "print server",
    ipAddress: "10.20.1.31",
    isOnline: true,
    lastSeenMinutesAgo: 6,
    alertCount: 0,
    inventory: {
      hardware: {
        manufacturer: "Generic",
        model: "Mini PC N100",
        serial: "GEN-MNPC-N100-841",
        cpu: "Intel N100 (4c/4t)",
        ramGb: 8,
        diskGb: 256,
        diskFreeGb: 219,
        biosVersion: "1.04",
        biosDate: "2024-11-21",
        purchaseDate: "2025-01-30",
      },
      os: {
        family: "linux",
        version: "Ubuntu Server 22.04.5 LTS",
        build: "5.15.0-117-generic",
        installedAt: "2025-02-04T22:11:00Z",
        lastBootAt: "2026-04-08T19:14:11Z",
        timezone: "America/New_York",
      },
      patches: { lastChecked: "2026-04-30T04:00:00Z", pending: 0, failed: 0 },
      software: { totalInstalled: 412, sample: ["cups", "samba", "openssh-server", "ufw"] },
      health: { cpu7d: 4, ramPct: 22, diskPct: 14 },
    },
  },
  {
    id: "mk-dev-mc-design-mac",
    clientName: "Mountain Creek Architects",
    hostname: "mc-design-mac-1",
    os: "darwin",
    osVersion: "macOS 14.5 (23F79)",
    role: "workstation",
    ipAddress: "10.55.1.42",
    isOnline: true,
    lastSeenMinutesAgo: 0,
    alertCount: 0,
    inventory: {
      hardware: {
        manufacturer: "Apple",
        model: "Mac Studio (M2 Max, 2023)",
        serial: "F2H4VK3D2X",
        cpu: "Apple M2 Max (12c CPU / 38c GPU)",
        ramGb: 64,
        diskGb: 2048,
        diskFreeGb: 980,
        biosVersion: "iBoot-10151.121.1",
        biosDate: "2024-05-13",
        purchaseDate: "2023-08-04",
      },
      os: {
        family: "darwin",
        version: "macOS Sonoma 14.5",
        build: "23F79",
        installedAt: "2023-08-08T17:00:00Z",
        lastBootAt: "2026-04-23T09:14:11Z",
        timezone: "America/Denver",
      },
      patches: { lastChecked: "2026-04-30T05:00:00Z", pending: 1, failed: 0 },
      software: { totalInstalled: 152, sample: ["AutoCAD 2026", "Revit 2026", "Adobe Creative Cloud", "Chrome 134"] },
      health: { cpu7d: 27, ramPct: 56, diskPct: 52 },
    },
  },
  {
    id: "mk-dev-mc-design-win",
    clientName: "Mountain Creek Architects",
    hostname: "mc-design-win-2",
    os: "windows",
    osVersion: "Windows 11 Pro 24H2 (10.0.26100.2161)",
    role: "workstation",
    ipAddress: "10.55.1.43",
    isOnline: false,
    lastSeenMinutesAgo: 38,
    alertCount: 1,
    alerts: [
      {
        kind: "agent.disconnected",
        severity: "warn",
        title: "Agent offline for 38m",
        detail: "Last heartbeat 38 minutes ago. Reboot in progress?",
        minutesAgo: 35,
      },
    ],
    inventory: {
      hardware: {
        manufacturer: "Lenovo",
        model: "ThinkStation P5",
        serial: "LN-P5-7M2HD9",
        cpu: "Intel Xeon W-2495X @ 2.9GHz (24c/48t)",
        ramGb: 128,
        diskGb: 4096,
        diskFreeGb: 1722,
        biosVersion: "S0VKT0BA",
        biosDate: "2024-12-02",
        purchaseDate: "2024-03-12",
      },
      os: {
        family: "windows",
        version: "Windows 11 Pro 24H2",
        build: "10.0.26100.2161",
        installedAt: "2024-03-19T14:11:14Z",
        lastBootAt: "2026-04-30T01:48:30Z",
        timezone: "America/Denver",
      },
      patches: { lastChecked: "2026-04-29T03:14:00Z", pending: 2, failed: 0 },
      software: { totalInstalled: 102, sample: ["AutoCAD 2026", "Revit 2026", "Microsoft 365 Apps"] },
      health: { cpu7d: 41, ramPct: 71, diskPct: 58 },
    },
  },
  {
    id: "mk-dev-mc-fileserver",
    clientName: "Mountain Creek Architects",
    hostname: "mc-fileserver",
    os: "linux",
    osVersion: "Ubuntu Server 24.04.1 LTS",
    role: "file server",
    ipAddress: "10.55.1.10",
    isOnline: true,
    lastSeenMinutesAgo: 2,
    alertCount: 0,
    inventory: {
      hardware: {
        manufacturer: "Supermicro",
        model: "SYS-510T-MR",
        serial: "SM-510TMR-K84M",
        cpu: "Intel Xeon E-2378G (8c/16t)",
        ramGb: 64,
        diskGb: 16384,
        diskFreeGb: 8002,
        biosVersion: "1.4a",
        biosDate: "2024-07-11",
        purchaseDate: "2024-09-30",
      },
      os: {
        family: "linux",
        version: "Ubuntu Server 24.04.1 LTS",
        build: "6.8.0-45-generic",
        installedAt: "2024-10-05T20:00:00Z",
        lastBootAt: "2026-04-12T03:14:11Z",
        timezone: "America/Denver",
      },
      patches: { lastChecked: "2026-04-30T04:00:00Z", pending: 1, failed: 0 },
      software: { totalInstalled: 502, sample: ["samba", "nfs-kernel-server", "zfs-utils-linux", "ufw"] },
      health: { cpu7d: 8, ramPct: 31, diskPct: 49 },
    },
  },
  {
    id: "mk-dev-mc-laptop-tomas",
    clientName: "Mountain Creek Architects",
    hostname: "mc-laptop-tomas",
    os: "darwin",
    osVersion: "macOS 14.5 (23F79)",
    role: "laptop",
    ipAddress: "10.55.5.18",
    isOnline: false,
    lastSeenMinutesAgo: 1320,
    alertCount: 1,
    alerts: [
      {
        kind: "agent.stale",
        severity: "info",
        title: "No heartbeat in 22 hours",
        detail: "Likely a laptop off-network with the user. Re-checks on next connect.",
        minutesAgo: 1_300,
      },
    ],
    inventory: {
      hardware: {
        manufacturer: "Apple",
        model: "MacBook Pro 16\" (M3 Pro, 2023)",
        serial: "C02XQ7FJD9",
        cpu: "Apple M3 Pro (12c CPU / 18c GPU)",
        ramGb: 36,
        diskGb: 1024,
        diskFreeGb: 412,
        biosVersion: "iBoot-10151.121.1",
        biosDate: "2024-05-13",
        purchaseDate: "2023-12-08",
      },
      os: {
        family: "darwin",
        version: "macOS Sonoma 14.5",
        build: "23F79",
        installedAt: "2023-12-12T14:00:00Z",
        lastBootAt: "2026-04-28T11:00:00Z",
        timezone: "America/Denver",
      },
      patches: { lastChecked: "2026-04-29T05:00:00Z", pending: 2, failed: 0 },
      software: { totalInstalled: 144, sample: ["AutoCAD 2026", "SketchUp Pro 2025", "Adobe Creative Cloud"] },
      health: { cpu7d: 15, ramPct: 38, diskPct: 60 },
    },
  },
]

export function getMockAlertsForDevice(deviceId: string): DeviceAlert[] {
  const seed = seeds.find((s) => s.id === deviceId)
  if (!seed?.alerts) return []
  const now = Date.now()
  return seed.alerts.map((a, i) => ({
    id: `${seed.id}-alert-${i}`,
    deviceId: seed.id,
    clientName: seed.clientName,
    kind: a.kind,
    severity: a.severity,
    title: a.title,
    detail: a.detail ?? null,
    state: a.state ?? "open",
    createdAt: new Date(now - a.minutesAgo * 60_000),
  }))
}

export function getMockDevices(): DeviceRow[] {
  const now = Date.now()
  return seeds.map((s) => ({
    id: s.id,
    clientName: s.clientName,
    hostname: s.hostname,
    os: s.os,
    osVersion: s.osVersion,
    role: s.role,
    ipAddress: s.ipAddress,
    isOnline: s.isOnline,
    lastSeenAt: new Date(now - s.lastSeenMinutesAgo * 60_000),
    inventory: s.inventory,
    alertCount: s.alertCount,
    isMock: true,
  }))
}

/**
 * All seeded alerts across the fleet, sorted newest-first. Used by
 * /alerts list view + dashboard counts when in mock mode.
 */
export function getMockAlertsAll(): DeviceAlert[] {
  const all: DeviceAlert[] = []
  for (const s of seeds) {
    if (!s.alerts) continue
    all.push(...getMockAlertsForDevice(s.id))
  }
  all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return all
}

/**
 * Synthesize an activity feed for a specific device — what would
 * naturally be in `fl_audit_log` given the device's state. Used by
 * /devices/[id] Activity tab in mock mode.
 *
 * Sources by descending recency:
 *  - `agent.heartbeat` at lastSeenAt (most recent)
 *  - `inventory.report` ~7 minutes earlier
 *  - one row per open alert (`alert.fire`)
 *  - `agent.session.opened` at the device's lastBootAt
 */
export function synthesizeDeviceActivity(deviceId: string, limit = 20): ActivityItem[] {
  const seed = seeds.find((s) => s.id === deviceId)
  if (!seed) return []
  const items: ActivityItem[] = []
  const now = Date.now()
  const lastSeen = new Date(now - seed.lastSeenMinutesAgo * 60_000)
  const lastBoot = new Date(seed.inventory.os.lastBootAt)

  if (seed.isOnline) {
    items.push({
      id: `${seed.id}-act-hb`,
      ts: relativeLastSeen(lastSeen),
      actor: null,
      action: "agent.heartbeat",
      outcome: "ok",
      detail: undefined,
    })
  } else {
    items.push({
      id: `${seed.id}-act-disc`,
      ts: relativeLastSeen(lastSeen),
      actor: null,
      action: "agent.disconnected",
      outcome: "error",
      detail: `last heartbeat ${relativeLastSeen(lastSeen)}`,
    })
  }

  items.push({
    id: `${seed.id}-act-inv`,
    ts: relativeLastSeen(new Date(lastSeen.getTime() - 7 * 60_000)),
    actor: null,
    action: "inventory.report",
    outcome: "ok",
    detail: `${seed.inventory.software.totalInstalled} apps · ${seed.inventory.patches.pending} patches pending`,
  })

  if (seed.alerts) {
    for (const a of seed.alerts) {
      items.push({
        id: `${seed.id}-act-alert-${a.kind}`,
        ts: relativeLastSeen(new Date(now - a.minutesAgo * 60_000)),
        actor: null,
        action: "alert.fire",
        outcome: a.severity === "critical" ? "error" : "pending",
        detail: a.title,
      })
    }
  }

  items.push({
    id: `${seed.id}-act-sess`,
    ts: relativeLastSeen(lastBoot),
    actor: null,
    action: "agent.session.opened",
    outcome: "ok",
    detail: `${seed.os} · v1.4.2`,
  })

  return items.slice(0, limit)
}

/**
 * Synthesize a fleet-wide activity feed — what the dashboard activity
 * card would show in mock mode. Aggregates alert.fire + agent.session
 * + inventory.report rows across the seed fleet.
 */
export function synthesizeFleetActivity(limit = 8): ActivityItem[] {
  const items: ActivityItem[] = []
  const now = Date.now()
  for (const s of seeds) {
    const lastSeen = new Date(now - s.lastSeenMinutesAgo * 60_000)
    if (s.alerts) {
      for (const a of s.alerts) {
        items.push({
          id: `${s.id}-feed-alert-${a.kind}`,
          ts: relativeLastSeen(new Date(now - a.minutesAgo * 60_000)),
          actor: null,
          action: "alert.fire",
          outcome: a.severity === "critical" ? "error" : "pending",
          detail: `${s.clientName} · ${s.hostname} · ${a.title}`,
        })
      }
    }
    if (!s.isOnline && s.lastSeenMinutesAgo < 24 * 60) {
      items.push({
        id: `${s.id}-feed-disc`,
        ts: relativeLastSeen(lastSeen),
        actor: null,
        action: "agent.disconnected",
        outcome: "error",
        detail: `${s.clientName} · ${s.hostname}`,
      })
    } else if (s.isOnline && s.lastSeenMinutesAgo < 5) {
      items.push({
        id: `${s.id}-feed-inv`,
        ts: relativeLastSeen(new Date(lastSeen.getTime() - 7 * 60_000)),
        actor: null,
        action: "inventory.report",
        outcome: "ok",
        detail: `${s.clientName} · ${s.hostname}`,
      })
    }
  }
  // Sort by parsed relative time is unreliable; sort by underlying ms
  // distance instead — the synthesizer baked recency into every entry.
  // Easier: sort lexicographically on ts since "Xs ago" < "Xm ago" < ...
  // Cleaner: compute the absolute Date here too and sort on that. Do
  // it the right way — re-derive timestamps.
  const tsMs = new Map<string, number>()
  for (const it of items) {
    tsMs.set(it.id, parseRelativeMs(it.ts))
  }
  items.sort((a, b) => (tsMs.get(a.id) ?? 0) - (tsMs.get(b.id) ?? 0))
  return items.slice(0, limit)
}

// "5s ago" → 5000, "2m ago" → 120_000, "3h ago" → 10_800_000, etc.
// Used only by synthesizeFleetActivity to sort. Cheaper than carrying
// the underlying Date around.
function parseRelativeMs(rel: string): number {
  const m = rel.match(/^(\d+)([smhd])\s+ago$/)
  if (!m) return Number.MAX_SAFE_INTEGER
  const n = Number(m[1])
  switch (m[2]) {
    case "s": return n * 1000
    case "m": return n * 60_000
    case "h": return n * 3_600_000
    case "d": return n * 86_400_000
    default:  return Number.MAX_SAFE_INTEGER
  }
}
