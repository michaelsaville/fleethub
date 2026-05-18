// Types + constants for the device-views module. Lives in its own
// file (no "use server") because the actions in lib/device-views.ts
// must export ONLY async functions per Next.js rules.

export type ViewFilters = {
  q?: string
  client?: string
  os?: ("windows" | "linux" | "darwin")[]
  /** tristate; absence means no filter */
  online?: "online" | "offline"
  role?: string[]
  /** true = has open alerts; false = no open alerts; undef = either */
  hasAlerts?: boolean
  maintenance?: "on" | "off"
  /** "yes" = agentId set; "no" = agentId null */
  enrolled?: "yes" | "no"
}

export type ViewSort = {
  field:
    | "lastSeen"
    | "hostname"
    | "friendlyName"
    | "alerts"
    | "client"
    | "os"
    | "role"
  direction: "asc" | "desc"
}

export type ViewVisibility = "PERSONAL" | "SHARED" | "SYSTEM"

export type DeviceViewRow = {
  id: string
  name: string
  filters: ViewFilters
  sort: ViewSort | null
  visibility: ViewVisibility
  icon: string | null
  displayOrder: number
}

/** Stable ids of /devices list columns that the user can hide/reorder.
 *  Always-visible: checkbox, name. */
export const HIDEABLE_COLUMN_IDS = [
  "client",
  "os",
  "role",
  "ip",
  "lastSeen",
  "alerts",
] as const
export type HideableColumnId = (typeof HIDEABLE_COLUMN_IDS)[number]
