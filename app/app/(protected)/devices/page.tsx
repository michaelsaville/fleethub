import AppShell from "@/components/AppShell"
import DeviceTable from "@/components/DeviceTable"
import SeedBanner from "@/components/SeedBanner"
import { listDevices } from "@/lib/devices"
import { getDeviceViews } from "@/lib/device-views"
import type { ViewFilters, ViewSort } from "@/lib/device-view-types"
import { getSessionContext } from "@/lib/authz"
import { ViewSelector } from "./ViewSelector"
import ColumnsMenu from "./ColumnsMenu"
import DeviceFilters from "./DeviceFilters"

export const dynamic = "force-dynamic"

type RawSearchParams = {
  q?: string
  client?: string
  os?: string
  online?: string
  role?: string
  hasAlerts?: string
  maintenance?: string
  enrolled?: string
  sort?: string
  sortField?: string
  sortDir?: string
  view?: string
}

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const sp = await searchParams
  const [ctx, viewBundle] = await Promise.all([
    getSessionContext(),
    getDeviceViews(),
  ])
  const { views, defaultViewId, hiddenColumns } = viewBundle

  // Resolve active view: ?view= URL > defaultViewId > first SYSTEM
  const activeView =
    views.find((v) => v.id === sp.view) ??
    views.find((v) => v.id === defaultViewId) ??
    views.find((v) => v.visibility === "SYSTEM") ??
    null

  // Build effective filters = view.filters with URL overrides on top.
  // Comma-separated arrays for os / role per the same convention TH uses.
  const overrideOs = parseOsList(sp.os)
  const overrideRole = parseList(sp.role)
  const effectiveFilters: ViewFilters = {
    ...(activeView?.filters ?? {}),
    ...(sp.q?.trim() ? { q: sp.q.trim() } : {}),
    ...(sp.client ? { client: sp.client } : {}),
    ...(overrideOs ? { os: overrideOs } : {}),
    ...(sp.online === "online" || sp.online === "offline" ? { online: sp.online } : {}),
    ...(overrideRole ? { role: overrideRole } : {}),
    ...(sp.hasAlerts === "true" ? { hasAlerts: true } : sp.hasAlerts === "false" ? { hasAlerts: false } : {}),
    ...(sp.maintenance === "on" || sp.maintenance === "off" ? { maintenance: sp.maintenance } : {}),
    ...(sp.enrolled === "yes" || sp.enrolled === "no" ? { enrolled: sp.enrolled } : {}),
  }
  const effectiveSort: ViewSort | null = sp.sortField
    ? {
        field: (sp.sortField as ViewSort["field"]) ?? "lastSeen",
        direction: sp.sortDir === "asc" ? "asc" : "desc",
      }
    : sp.sort
      ? { field: sp.sort as ViewSort["field"], direction: "desc" }
      : activeView?.sort ?? null

  const { rows, totalBeforeFilter, isMock, facets } = await listDevices({
    q: effectiveFilters.q,
    client: effectiveFilters.client,
    os: effectiveFilters.os as DeviceListFilterOs,
    online: effectiveFilters.online,
    role: effectiveFilters.role,
    hasAlerts: effectiveFilters.hasAlerts,
    maintenance: effectiveFilters.maintenance,
    enrolled: effectiveFilters.enrolled,
    sortField: effectiveSort?.field,
    sortDir: effectiveSort?.direction,
  })

  // Overlay = URL-provided params that diverge from the view's saved filter+sort
  const hasOverlay =
    !!sp.q || !!sp.client || !!sp.os || !!sp.online || !!sp.role ||
    !!sp.hasAlerts || !!sp.maintenance || !!sp.enrolled ||
    !!sp.sort || !!sp.sortField

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Devices
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
              Pick a saved view or filter live. Star a personal view to make
              it your default.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {hasOverlay ? (
                <>Showing <strong style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{rows.length}</strong> of {totalBeforeFilter}</>
              ) : (
                <><strong style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{totalBeforeFilter}</strong> total</>
              )}
            </span>
            <ColumnsMenu hiddenColumns={hiddenColumns} />
          </div>
        </header>

        {isMock && <SeedBanner kind="fleet" />}

        <ViewSelector
          views={views}
          defaultViewId={defaultViewId}
          activeViewId={activeView?.id ?? null}
          currentFilters={effectiveFilters}
          currentSort={effectiveSort}
          isAdmin={ctx?.role === "ADMIN"}
        />

        <DeviceFilters filters={effectiveFilters} facets={facets} />

        <DeviceTable rows={rows} hiddenColumns={hiddenColumns} />
      </div>
    </AppShell>
  )
}

type DeviceListFilterOs = ("windows" | "linux" | "darwin")[] | undefined

function parseList(s?: string): string[] | undefined {
  if (!s) return undefined
  const xs = s.split(",").map((x) => x.trim()).filter(Boolean)
  return xs.length > 0 ? xs : undefined
}
function parseOsList(s?: string): ("windows" | "linux" | "darwin")[] | undefined {
  const xs = parseList(s)
  if (!xs) return undefined
  const ok = xs.filter((x): x is "windows" | "linux" | "darwin" =>
    x === "windows" || x === "linux" || x === "darwin",
  )
  return ok.length > 0 ? ok : undefined
}

