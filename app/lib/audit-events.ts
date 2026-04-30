import "server-only"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

/**
 * Read-side helpers over Fl_AuditLog. The hash-chain itself is verified
 * by /api/audit/verify; this module is for human investigation —
 * "show me everything Mike did yesterday" or "what touched device X."
 */

export interface AuditEventRow {
  id: string
  createdAt: Date
  actorEmail: string | null
  clientName: string | null
  deviceId: string | null
  deviceHostname: string | null
  action: string
  outcome: "ok" | "error" | "pending"
  detail: string | null
  detailJson: string | null
  rowHash: string | null
  prevHash: string | null
}

export interface AuditFilters {
  actorEmail?: string
  action?: string
  outcome?: "ok" | "error" | "pending" | "all"
  clientName?: string
  deviceId?: string
  /** ISO date strings (inclusive). */
  fromIso?: string
  toIso?: string
}

export interface AuditListResult {
  rows: AuditEventRow[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  facets: {
    actors: string[]
    actions: string[]
  }
}

const PAGE_SIZE = 50

function buildWhere(filters: AuditFilters): Prisma.Fl_AuditLogWhereInput {
  const w: Prisma.Fl_AuditLogWhereInput = {}
  if (filters.actorEmail) w.actorEmail = filters.actorEmail.toLowerCase()
  if (filters.action)     w.action     = { startsWith: filters.action }
  if (filters.outcome && filters.outcome !== "all") w.outcome = filters.outcome
  if (filters.clientName) w.clientName = filters.clientName
  if (filters.deviceId)   w.deviceId   = filters.deviceId
  if (filters.fromIso || filters.toIso) {
    w.createdAt = {}
    if (filters.fromIso) w.createdAt.gte = new Date(filters.fromIso)
    if (filters.toIso)   w.createdAt.lte = new Date(filters.toIso)
  }
  return w
}

export async function listAuditEvents(
  filters: AuditFilters = {},
  page = 1,
): Promise<AuditListResult> {
  const where = buildWhere(filters)

  const [total, dbRows, allActors, allActions] = await Promise.all([
    prisma.fl_AuditLog.count({ where }),
    prisma.fl_AuditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.fl_AuditLog.findMany({
      where: { actorEmail: { not: null } },
      distinct: ["actorEmail"],
      select: { actorEmail: true },
      take: 100,
    }),
    prisma.fl_AuditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      take: 200,
    }),
  ])

  const deviceIds = [...new Set(dbRows.map((r) => r.deviceId).filter((x): x is string => !!x))]
  const devices = deviceIds.length
    ? await prisma.fl_Device.findMany({
        where: { id: { in: deviceIds } },
        select: { id: true, hostname: true },
      })
    : []
  const hostnameById = new Map(devices.map((d) => [d.id, d.hostname]))

  const rows: AuditEventRow[] = dbRows.map((r) => {
    let detail: string | null = null
    if (r.detailJson) {
      try {
        const parsed = JSON.parse(r.detailJson) as Record<string, unknown>
        const msg = typeof parsed.message === "string" ? parsed.message : null
        detail = msg ?? r.detailJson
      } catch {
        detail = r.detailJson
      }
    }
    return {
      id: r.id,
      createdAt: r.createdAt,
      actorEmail: r.actorEmail,
      clientName: r.clientName,
      deviceId: r.deviceId,
      deviceHostname: r.deviceId ? hostnameById.get(r.deviceId) ?? null : null,
      action: r.action,
      outcome: (r.outcome as AuditEventRow["outcome"]) ?? "ok",
      detail,
      detailJson: r.detailJson,
      rowHash: r.rowHash,
      prevHash: r.prevHash,
    }
  })

  return {
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    facets: {
      actors:  allActors.map((a) => a.actorEmail!).filter(Boolean).sort(),
      actions: allActions.map((a) => a.action).sort(),
    },
  }
}
