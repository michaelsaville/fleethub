"use server"

import { prisma } from "@/lib/prisma"
import { getSessionContext, type SessionContext } from "@/lib/authz"
import { revalidatePath } from "next/cache"
import {
  HIDEABLE_COLUMN_IDS,
  type ViewFilters,
  type ViewSort,
  type ViewVisibility,
  type DeviceViewRow,
} from "@/lib/device-view-types"

/** Resolve `ctx` and assert ctx.id is non-null. Most mutations against
 *  Fl_DeviceView / Fl_UserDevicePreference are user-scoped so we need a
 *  stable Fl_StaffUser.id. Session.id is nullable in the type but
 *  populated for every signed-in operator post-Phase 11. */
async function requireUserCtx(): Promise<SessionContext & { id: string }> {
  const ctx = await getSessionContext()
  if (!ctx) throw new Error("Not authenticated")
  if (!ctx.id) throw new Error("Session is missing the user id — re-login")
  return ctx as SessionContext & { id: string }
}

/** Same as requireUserCtx but returns null on miss (for read-only paths
 *  that should gracefully render an empty list). */
async function tryUserCtx(): Promise<(SessionContext & { id: string }) | null> {
  const ctx = await getSessionContext()
  if (!ctx || !ctx.id) return null
  return ctx as SessionContext & { id: string }
}

// Wave B — Fl_DeviceView + Fl_UserDevicePreference server actions.
// Mirrors tickethub/app/lib/actions/ticket-views.ts 1:1. FleetHub uses
// JSON-encoded text columns (not Prisma Json) to match the rest of the
// schema's convention (inventoryJson, savedViewsJson, etc.).

// Types + HIDEABLE_COLUMN_IDS live in lib/device-view-types.ts so this
// "use server" file exports only async functions.
const HIDEABLE_SET = new Set<string>(HIDEABLE_COLUMN_IDS)

// ─── System view definitions (seeded on first load) ────────────────────

const SYSTEM_VIEWS: Array<{
  name: string
  icon: string
  filters: ViewFilters
  sort: ViewSort | null
  displayOrder: number
}> = [
  {
    name: "All Online",
    icon: "🟢",
    filters: { online: "online" },
    sort: { field: "lastSeen", direction: "desc" },
    displayOrder: 0,
  },
  {
    name: "Offline >24h",
    icon: "🔴",
    filters: { online: "offline" },
    sort: { field: "lastSeen", direction: "desc" },
    displayOrder: 1,
  },
  {
    name: "Has Open Alerts",
    icon: "⚠️",
    filters: { hasAlerts: true },
    sort: { field: "alerts", direction: "desc" },
    displayOrder: 2,
  },
  {
    name: "In Maintenance",
    icon: "🛠",
    filters: { maintenance: "on" },
    sort: { field: "lastSeen", direction: "desc" },
    displayOrder: 3,
  },
  {
    name: "Workstations",
    icon: "💻",
    filters: { role: ["workstation"] },
    sort: { field: "lastSeen", direction: "desc" },
    displayOrder: 4,
  },
  {
    name: "Servers",
    icon: "🖥",
    filters: { role: ["server"] },
    sort: { field: "lastSeen", direction: "desc" },
    displayOrder: 5,
  },
  {
    name: "Not Enrolled",
    icon: "🔌",
    filters: { enrolled: "no" },
    sort: { field: "lastSeen", direction: "desc" },
    displayOrder: 6,
  },
  {
    name: "All Devices",
    icon: "📋",
    filters: {},
    sort: { field: "lastSeen", direction: "desc" },
    displayOrder: 7,
  },
]

// ─── Ensure system views exist (idempotent) ────────────────────────────

export async function ensureSystemViews() {
  const existing = await prisma.fl_DeviceView.findMany({
    where: { visibility: "SYSTEM" },
    select: { name: true },
  })
  const existingNames = new Set(existing.map((v) => v.name))
  for (const sv of SYSTEM_VIEWS) {
    if (existingNames.has(sv.name)) continue
    await prisma.fl_DeviceView.create({
      data: {
        name: sv.name,
        filtersJson: JSON.stringify(sv.filters),
        sortJson: sv.sort ? JSON.stringify(sv.sort) : null,
        visibility: "SYSTEM",
        icon: sv.icon,
        displayOrder: sv.displayOrder,
        userId: null,
      },
    })
  }
}

// ─── Fetch views + preference for current user ─────────────────────────

export async function getDeviceViews(): Promise<{
  views: DeviceViewRow[]
  defaultViewId: string | null
  hiddenColumns: string[]
  columnOrder: string[]
}> {
  const ctx = await tryUserCtx()
  if (!ctx) {
    return { views: [], defaultViewId: null, hiddenColumns: [], columnOrder: [] }
  }
  await ensureSystemViews()

  const [views, pref] = await Promise.all([
    prisma.fl_DeviceView.findMany({
      where: {
        OR: [
          { visibility: "SYSTEM" },
          { visibility: "SHARED" },
          { userId: ctx.id },
        ],
      },
      orderBy: [{ visibility: "asc" }, { displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.fl_UserDevicePreference.findUnique({
      where: { userId: ctx.id },
    }),
  ])

  return {
    views: views.map((v) => ({
      id: v.id,
      name: v.name,
      filters: safeParse<ViewFilters>(v.filtersJson) ?? {},
      sort: v.sortJson ? safeParse<ViewSort>(v.sortJson) : null,
      visibility: v.visibility as ViewVisibility,
      icon: v.icon,
      displayOrder: v.displayOrder,
    })),
    defaultViewId: pref?.defaultViewId ?? null,
    hiddenColumns: pref?.hiddenColumns ?? [],
    columnOrder: pref?.columnOrder ?? [],
  }
}

// ─── Create / update / delete personal view ────────────────────────────

export async function createDeviceView(data: {
  name: string
  filters: ViewFilters
  sort?: ViewSort | null
  visibility?: "PERSONAL" | "SHARED"
  icon?: string | null
}) {
  const ctx = await requireUserCtx()
  if (data.visibility === "SHARED" && ctx.role !== "ADMIN") {
    throw new Error("Admin role required to create a SHARED view")
  }

  const maxOrder = await prisma.fl_DeviceView.aggregate({
    where: { userId: ctx.id },
    _max: { displayOrder: true },
  })
  const view = await prisma.fl_DeviceView.create({
    data: {
      name: data.name.trim().slice(0, 80),
      filtersJson: JSON.stringify(data.filters ?? {}),
      sortJson: data.sort ? JSON.stringify(data.sort) : null,
      visibility: data.visibility ?? "PERSONAL",
      icon: data.icon ?? null,
      userId: data.visibility === "SHARED" ? null : ctx.id,
      displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
    },
  })
  revalidatePath("/devices")
  return view
}

export async function updateDeviceView(
  viewId: string,
  data: {
    name?: string
    filters?: ViewFilters
    sort?: ViewSort | null
    icon?: string | null
  },
) {
  const ctx = await requireUserCtx()
  const view = await prisma.fl_DeviceView.findUnique({ where: { id: viewId } })
  if (!view) throw new Error("View not found")
  if (view.visibility === "SYSTEM") throw new Error("Cannot edit system views")
  if (view.visibility === "PERSONAL" && view.userId !== ctx.id) {
    throw new Error("Not your view")
  }
  if (view.visibility === "SHARED" && ctx.role !== "ADMIN") {
    throw new Error("Admin role required to edit a SHARED view")
  }

  const update: {
    name?: string
    filtersJson?: string
    sortJson?: string | null
    icon?: string | null
  } = {}
  if (data.name !== undefined) update.name = data.name.trim().slice(0, 80)
  if (data.filters !== undefined) update.filtersJson = JSON.stringify(data.filters)
  if (data.sort !== undefined) update.sortJson = data.sort ? JSON.stringify(data.sort) : null
  if (data.icon !== undefined) update.icon = data.icon

  const updated = await prisma.fl_DeviceView.update({
    where: { id: viewId },
    data: update,
  })
  revalidatePath("/devices")
  return updated
}

export async function deleteDeviceView(viewId: string) {
  const ctx = await requireUserCtx()
  const view = await prisma.fl_DeviceView.findUnique({ where: { id: viewId } })
  if (!view) throw new Error("View not found")
  if (view.visibility === "SYSTEM") throw new Error("Cannot delete system views")
  if (view.visibility === "PERSONAL" && view.userId !== ctx.id) {
    throw new Error("Not your view")
  }
  if (view.visibility === "SHARED" && ctx.role !== "ADMIN") {
    throw new Error("Admin role required to delete a SHARED view")
  }

  await prisma.fl_DeviceView.delete({ where: { id: viewId } })
  await prisma.fl_UserDevicePreference.deleteMany({
    where: { defaultViewId: viewId },
  })
  revalidatePath("/devices")
}

// ─── Set default + per-user column prefs ───────────────────────────────

export async function setDefaultDeviceView(viewId: string) {
  const ctx = await requireUserCtx()
  await prisma.fl_UserDevicePreference.upsert({
    where: { userId: ctx.id },
    create: { userId: ctx.id, defaultViewId: viewId },
    update: { defaultViewId: viewId },
  })
  revalidatePath("/devices")
}

export async function setHiddenColumns(
  ids: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireUserCtx()
  const cleaned = Array.from(new Set(ids.filter((id) => HIDEABLE_SET.has(id))))
  try {
    await upsertPrefWithDefaults(ctx.id, { hiddenColumns: cleaned })
    revalidatePath("/devices")
    return { ok: true }
  } catch (e) {
    console.error("[device-views] setHiddenColumns failed", e)
    return { ok: false, error: "Failed to save column preference" }
  }
}

export async function setColumnOrder(
  ids: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireUserCtx()
  const cleaned = Array.from(new Set(ids.filter((id) => HIDEABLE_SET.has(id))))
  try {
    await upsertPrefWithDefaults(ctx.id, { columnOrder: cleaned })
    revalidatePath("/devices")
    return { ok: true }
  } catch (e) {
    console.error("[device-views] setColumnOrder failed", e)
    return { ok: false, error: "Failed to save column order" }
  }
}

async function upsertPrefWithDefaults(
  userId: string,
  patch: { hiddenColumns?: string[]; columnOrder?: string[] },
) {
  const existing = await prisma.fl_UserDevicePreference.findUnique({
    where: { userId },
    select: { id: true, defaultViewId: true },
  })
  if (existing) {
    await prisma.fl_UserDevicePreference.update({
      where: { userId },
      data: patch,
    })
    return
  }
  // Anchor pref row on the first SYSTEM view so defaultViewId is non-null.
  const sys = await prisma.fl_DeviceView.findFirst({
    where: { visibility: "SYSTEM" },
    orderBy: { displayOrder: "asc" },
    select: { id: true },
  })
  if (!sys) {
    throw new Error("No SYSTEM view to anchor preference (call ensureSystemViews first)")
  }
  await prisma.fl_UserDevicePreference.create({
    data: {
      userId,
      defaultViewId: sys.id,
      hiddenColumns: patch.hiddenColumns ?? [],
      columnOrder: patch.columnOrder ?? [],
    },
  })
}

// ─── Reorder views within a visibility group ───────────────────────────

export async function reorderDeviceViews({
  visibility,
  orderedIds,
}: {
  visibility: ViewVisibility
  orderedIds: string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireUserCtx()
  if (visibility !== "PERSONAL" && ctx.role !== "ADMIN") {
    return { ok: false, error: "Admin role required for SHARED / SYSTEM views" }
  }
  if (orderedIds.length === 0) return { ok: true }

  const where =
    visibility === "PERSONAL"
      ? { id: { in: orderedIds }, visibility: "PERSONAL" as const, userId: ctx.id }
      : { id: { in: orderedIds }, visibility }
  const rows = await prisma.fl_DeviceView.findMany({ where, select: { id: true } })
  if (rows.length !== orderedIds.length) {
    return { ok: false, error: "Some views are missing or in another visibility group" }
  }
  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.fl_DeviceView.update({ where: { id }, data: { displayOrder: idx } }),
    ),
  )
  revalidatePath("/devices")
  return { ok: true }
}

// ─── helpers ───────────────────────────────────────────────────────────

function safeParse<T>(s: string | null | undefined): T | null {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}
