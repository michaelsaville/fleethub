import "server-only"
import { prisma } from "@/lib/prisma"

// Cmd-K command parser. Recognizes the verbs from PHASE-3-DESIGN §14
// + PHASE-2-DESIGN §8 and resolves them to fully-qualified destinations:
//
//   deploy <package> [to <client|rql>]       → /deployments/new pre-filled
//   update <package> [on <client|rql>]       → /deployments/new (action=update)
//   uninstall <package> from <client|rql>    → /deployments/new (action=uninstall)
//   catch up <package>                       → /software?tab=drift (operator
//                                              clicks the row's Catch up →
//                                              for the off-version targets)
//   maintenance <hostname> [for <duration>]  → /devices/[id] (operator clicks
//                                              the toggle; duration in hint)
//   run script <name> [on <host>]            → /scripts/[id]/run pre-filled
//
// Fuzzy match on package name + device hostname/client; multiple matches
// each emit their own command result so the operator picks via ↑/↓.

export interface PaletteCommand {
  id: string
  category: "Commands"
  label: string
  hint: string
  href: string
  icon: string
}

const MAX_PER_VERB = 5

export async function parsePaletteCommand(query: string): Promise<PaletteCommand[]> {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []
  const tokens = q.split(/\s+/)

  // catch up <package>
  if (tokens[0] === "catch" && tokens[1] === "up" && tokens.length >= 3) {
    return resolveCatchUp(tokens.slice(2).join(" "))
  }
  if (tokens[0] === "catchup" && tokens.length >= 2) {
    return resolveCatchUp(tokens.slice(1).join(" "))
  }

  // deploy <package> [to <target>]
  if (tokens[0] === "deploy" && tokens.length >= 2) {
    const toIdx = tokens.indexOf("to")
    const pkgQ = tokens.slice(1, toIdx > 0 ? toIdx : undefined).join(" ")
    const tgtQ = toIdx > 0 ? tokens.slice(toIdx + 1).join(" ") : null
    return resolveDeploy(pkgQ, tgtQ, "install")
  }

  // update <package> [on <target>]
  if (tokens[0] === "update" && tokens.length >= 2) {
    const onIdx = tokens.indexOf("on")
    const pkgQ = tokens.slice(1, onIdx > 0 ? onIdx : undefined).join(" ")
    const tgtQ = onIdx > 0 ? tokens.slice(onIdx + 1).join(" ") : null
    return resolveDeploy(pkgQ, tgtQ, "update")
  }

  // uninstall <package> from <target>
  if (tokens[0] === "uninstall" && tokens.length >= 2) {
    const fromIdx = tokens.indexOf("from")
    const pkgQ = tokens.slice(1, fromIdx > 0 ? fromIdx : undefined).join(" ")
    const tgtQ = fromIdx > 0 ? tokens.slice(fromIdx + 1).join(" ") : null
    return resolveDeploy(pkgQ, tgtQ, "uninstall")
  }

  // maintenance <host> [for <duration>] / maint <host>
  if ((tokens[0] === "maintenance" || tokens[0] === "maint") && tokens.length >= 2) {
    const forIdx = tokens.indexOf("for")
    const hostQ = tokens.slice(1, forIdx > 0 ? forIdx : undefined).join(" ")
    const durStr = forIdx > 0 ? tokens.slice(forIdx + 1).join(" ") : null
    return resolveMaintenance(hostQ, durStr)
  }

  // run script <name> [on <host>] / run <name>
  if (tokens[0] === "run" && tokens.length >= 2) {
    const isScriptKw = tokens[1] === "script"
    const startIdx = isScriptKw ? 2 : 1
    if (startIdx >= tokens.length) return []
    const onIdx = tokens.indexOf("on", startIdx)
    const scriptQ = tokens.slice(startIdx, onIdx > 0 ? onIdx : undefined).join(" ")
    const hostQ = onIdx > 0 ? tokens.slice(onIdx + 1).join(" ") : null
    return resolveRunScript(scriptQ, hostQ)
  }

  return []
}

// ─── deploy / update / uninstall ──────────────────────────────────────

async function resolveDeploy(
  pkgQuery: string,
  targetQuery: string | null,
  action: "install" | "update" | "uninstall",
): Promise<PaletteCommand[]> {
  if (!pkgQuery) return []
  const packages = await prisma.fl_Package.findMany({
    where: {
      archivedAt: null,
      isApproved: true,
      name: { contains: pkgQuery, mode: "insensitive" },
    },
    include: {
      versions: {
        where: { isApprovedDefault: true },
        take: 1,
      },
    },
    take: MAX_PER_VERB,
    orderBy: { name: "asc" },
  })
  if (packages.length === 0) return []

  // If a target was given, pre-resolve target devices (one query per
  // package-tenant pair). Cap at 200 ids in the URL — over that, skip
  // pre-fill and let the operator pick on the form.
  return Promise.all(
    packages.map(async (p) => {
      let targetIds: string[] = []
      let targetSummary: string | null = null
      if (targetQuery) {
        const matched = await resolveTargets(p.tenantName, targetQuery)
        targetIds = matched.ids.slice(0, 200)
        targetSummary = matched.summary
      }
      const verb = action === "install" ? "Deploy" : action === "update" ? "Update" : "Uninstall"
      const versionPart = p.versions[0]?.version ? ` ${p.versions[0].version}` : ""
      const targetPart = targetSummary ? ` to ${targetSummary}` : ""
      const params = new URLSearchParams({
        packageId: p.id,
        ...(targetIds.length > 0 && { targets: targetIds.join(",") }),
      })
      return {
        id: `cmd:deploy:${p.id}:${action}:${targetQuery ?? "all"}`,
        category: "Commands" as const,
        label: `${verb} ${p.name}${versionPart}${targetPart}`,
        hint: `${p.tenantName} · ${p.source} · ${p.os} · pre-fills the deploy form`,
        href: `/deployments/new?${params.toString()}`,
        icon: action === "uninstall" ? "🗑" : action === "update" ? "🔁" : "🚀",
      }
    }),
  )
}

interface ResolvedTargets {
  ids: string[]
  summary: string
}

async function resolveTargets(tenantName: string, targetQuery: string): Promise<ResolvedTargets> {
  // Heuristic: try matching against clientName first (most common
  // operator phrasing: "deploy chrome to acme"), fall back to
  // hostname / role, fall back to all.
  const lower = targetQuery.toLowerCase()
  if (lower === "all" || lower === "fleet" || lower === "*") {
    const all = await prisma.fl_Device.findMany({
      where: { isActive: true, clientName: tenantName, maintenanceMode: false },
      select: { id: true },
    })
    return { ids: all.map((d) => d.id), summary: `${tenantName} fleet` }
  }
  // Exact-ish client match wins.
  const clientMatch = await prisma.fl_Device.findMany({
    where: {
      isActive: true,
      maintenanceMode: false,
      clientName: { contains: targetQuery, mode: "insensitive" },
    },
    select: { id: true, clientName: true },
  })
  if (clientMatch.length > 0) {
    const distinctClient = Array.from(new Set(clientMatch.map((d) => d.clientName)))
    const summary =
      distinctClient.length === 1
        ? distinctClient[0]
        : `${clientMatch.length} hosts across ${distinctClient.length} clients`
    return { ids: clientMatch.map((d) => d.id), summary }
  }
  // Fall back to hostname/role contains.
  const hostMatch = await prisma.fl_Device.findMany({
    where: {
      isActive: true,
      maintenanceMode: false,
      OR: [
        { hostname: { contains: targetQuery, mode: "insensitive" } },
        { role: { contains: targetQuery, mode: "insensitive" } },
      ],
    },
    select: { id: true, hostname: true },
  })
  return {
    ids: hostMatch.map((d) => d.id),
    summary: hostMatch.length === 1 ? hostMatch[0].hostname : `${hostMatch.length} hosts matching "${targetQuery}"`,
  }
}

// ─── catch up <package> ───────────────────────────────────────────────
//
// v1: navigate to /software?tab=drift. The drift table already has a
// "Catch up →" button per row that handles the off-version targets
// pre-population. Two clicks instead of one, but avoids running
// computeDrift on every keystroke in the palette.

async function resolveCatchUp(pkgQuery: string): Promise<PaletteCommand[]> {
  if (!pkgQuery) return []
  const packages = await prisma.fl_Package.findMany({
    where: {
      archivedAt: null,
      isApproved: true,
      name: { contains: pkgQuery, mode: "insensitive" },
    },
    take: MAX_PER_VERB,
    orderBy: { name: "asc" },
    select: { id: true, name: true, source: true, os: true, tenantName: true },
  })
  return packages.map((p) => ({
    id: `cmd:catch-up:${p.id}`,
    category: "Commands" as const,
    label: `Catch up ${p.name}`,
    hint: `${p.tenantName} · ${p.source} · ${p.os} · opens drift view`,
    href: `/software?tab=drift`,
    icon: "📈",
  }))
}

// ─── maintenance <host> [for <duration>] ─────────────────────────────

async function resolveMaintenance(
  hostQuery: string,
  durationStr: string | null,
): Promise<PaletteCommand[]> {
  if (!hostQuery) return []
  const devices = await prisma.fl_Device.findMany({
    where: {
      isActive: true,
      OR: [
        { hostname: { contains: hostQuery, mode: "insensitive" } },
        { ipAddress: { contains: hostQuery, mode: "insensitive" } },
      ],
    },
    take: MAX_PER_VERB,
    orderBy: [{ isOnline: "desc" }, { lastSeenAt: "desc" }],
    select: {
      id: true,
      hostname: true,
      clientName: true,
      maintenanceMode: true,
      isOnline: true,
    },
  })
  const dur = durationStr ? parseDuration(durationStr) : null
  const durHint = dur ? `for ${formatDuration(dur)}` : "indefinite"

  return devices.map((d) => {
    const verb = d.maintenanceMode ? "Release maintenance:" : "Set maintenance:"
    return {
      id: `cmd:maint:${d.id}`,
      category: "Commands" as const,
      label: `${verb} ${d.hostname}`,
      hint: `${d.clientName} · ${durHint} · opens device detail`,
      href: `/devices/${d.id}`,
      icon: "🔒",
    }
  })
}

function parseDuration(s: string): number | null {
  const m = s.trim().match(/^(\d+)\s*([smhdw])$/i)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  const mult = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : unit === "d" ? 86400 : unit === "w" ? 604800 : 0
  return n * mult * 1000
}
function formatDuration(ms: number): string {
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 1000)}s`
}

// ─── run script <name> [on <host>] ───────────────────────────────────

async function resolveRunScript(
  scriptQuery: string,
  hostQuery: string | null,
): Promise<PaletteCommand[]> {
  if (!scriptQuery) return []
  const scripts = await prisma.fl_Script.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: scriptQuery, mode: "insensitive" } },
        { category: { contains: scriptQuery, mode: "insensitive" } },
      ],
    },
    take: MAX_PER_VERB,
    orderBy: [{ isCurated: "desc" }, { updatedAt: "desc" }],
    select: { id: true, name: true, shell: true, category: true },
  })
  if (scripts.length === 0) return []

  // If a host was specified, pre-resolve to first matching device.
  let targetDeviceId: string | null = null
  let hostHint: string | null = null
  if (hostQuery) {
    const device = await prisma.fl_Device.findFirst({
      where: {
        isActive: true,
        OR: [
          { hostname: { contains: hostQuery, mode: "insensitive" } },
          { ipAddress: { contains: hostQuery, mode: "insensitive" } },
        ],
      },
      orderBy: [{ isOnline: "desc" }, { lastSeenAt: "desc" }],
      select: { id: true, hostname: true },
    })
    if (device) {
      targetDeviceId = device.id
      hostHint = ` on ${device.hostname}`
    }
  }
  return scripts.map((s) => {
    const params = targetDeviceId ? `?targetDeviceId=${targetDeviceId}` : ""
    return {
      id: `cmd:run-script:${s.id}:${targetDeviceId ?? "any"}`,
      category: "Commands" as const,
      label: `Run script ${s.name}${hostHint ?? ""}`,
      hint: `${s.shell} · ${s.category ?? "uncategorized"} · pre-fills run form`,
      href: `/scripts/${s.id}/run${params}`,
      icon: "⚡",
    }
  })
}
