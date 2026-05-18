import "server-only"
import { prisma } from "@/lib/prisma"
import { clientSlug } from "@/lib/msp-rollup"

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

  // patch <kbId|cve> [to <client|rql>]
  if (tokens[0] === "patch" && tokens.length >= 2) {
    const toIdx = tokens.indexOf("to")
    const idQ = tokens.slice(1, toIdx > 0 ? toIdx : undefined).join(" ")
    const tgtQ = toIdx > 0 ? tokens.slice(toIdx + 1).join(" ") : null
    return resolvePatch(idQ, tgtQ)
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

  // triage [signal|severity|<client-name>]
  if (tokens[0] === "triage") {
    return resolveTriage(tokens.slice(1).join(" "))
  }

  // ack <alert-id-or-substring>
  if (tokens[0] === "ack" && tokens.length >= 2) {
    return resolveAck(tokens.slice(1).join(" "))
  }

  // escalate <alert-id-or-substring>
  if (tokens[0] === "escalate" && tokens.length >= 2) {
    return resolveEscalate(tokens.slice(1).join(" "))
  }

  // disable runbook <name-substring>
  if (tokens[0] === "disable" && tokens[1] === "runbook" && tokens.length >= 3) {
    return resolveRunbookVerb(tokens.slice(2).join(" "), "disable")
  }

  // untrip <runbook-name-substring>
  if (tokens[0] === "untrip" && tokens.length >= 2) {
    return resolveRunbookVerb(tokens.slice(1).join(" "), "untrip")
  }

  // route <severity> <kind-glob> [client]
  if (tokens[0] === "route" && tokens.length >= 3) {
    return resolveRouteVerb(tokens.slice(1))
  }

  // oncall <schedule-name>
  if (tokens[0] === "oncall" && tokens.length >= 2) {
    return resolveOncallVerb(tokens.slice(1).join(" "))
  }

  // enroll device — no args; static OpsHub deep-link
  if (tokens[0] === "enroll" && tokens[1] === "device") {
    return resolveEnrollDevice()
  }

  // enable portal <client>
  if (tokens[0] === "enable" && tokens[1] === "portal" && tokens.length >= 3) {
    return resolveTenantTabVerb(tokens.slice(2).join(" "), "settings", "portal")
  }

  // branding <client>
  if (tokens[0] === "branding" && tokens.length >= 2) {
    return resolveTenantTabVerb(tokens.slice(1).join(" "), "branding", "branding")
  }

  // rustdesk id <host>
  if (tokens[0] === "rustdesk" && tokens[1] === "id" && tokens.length >= 3) {
    return resolveRustdeskIdVerb(tokens.slice(2).join(" "))
  }

  // monitor <q>
  if (tokens[0] === "monitor" && tokens.length >= 2) {
    return resolveMonitorVerb(tokens.slice(1).join(" "))
  }

  // inbound webhook <q> / webhook <q>
  if (tokens[0] === "inbound" && tokens[1] === "webhook" && tokens.length >= 3) {
    return resolveInboundWebhookVerb(tokens.slice(2).join(" "))
  }
  if (tokens[0] === "webhook" && tokens.length >= 2) {
    return resolveInboundWebhookVerb(tokens.slice(1).join(" "))
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

// ─── patch <kbId|cve> [to <client|rql>] ───────────────────────────────
//
// Looks for either a KB id ("KB5036893" or just "5036893") in
// Fl_Patch.sourceId, or a CVE id ("CVE-2024-XXXX") in Fl_PatchAdvisory
// (resolves to patches that close it). Emits one command per matching
// patch with affected device ids pre-populated as deploy targets.

async function resolvePatch(idQ: string, targetQ: string | null): Promise<PaletteCommand[]> {
  if (!idQ) return []
  const upper = idQ.toUpperCase()
  const isCve = /^CVE-\d{4}-\d{4,}$/.test(upper)

  if (isCve) {
    const adv = await prisma.fl_PatchAdvisory.findUnique({ where: { cveId: upper } })
    if (!adv) return []
    const patches = await prisma.fl_Patch.findMany({ where: { cveJson: { not: null } } })
    const matching = patches.filter((p) => parseCveListInline(p.cveJson).includes(upper)).slice(0, MAX_PER_VERB)
    return Promise.all(matching.map((p) => buildPatchCommand(p, idQ, adv.isKev, targetQ)))
  }

  const stripped = upper.replace(/^KB/, "")
  const patches = await prisma.fl_Patch.findMany({
    where: {
      OR: [
        { sourceId: { contains: idQ, mode: "insensitive" } },
        { sourceId: { contains: stripped, mode: "insensitive" } },
      ],
    },
    take: MAX_PER_VERB,
    orderBy: [{ isKev: "desc" }, { cvssMax: "desc" }, { ingestedAt: "desc" }],
  })
  return Promise.all(patches.map((p) => buildPatchCommand(p, idQ, p.isKev, targetQ)))
}

async function buildPatchCommand(
  patch: { id: string; sourceId: string; title: string; source: string; os: string; isHotpatch: boolean },
  matchToken: string,
  isKev: boolean,
  targetQ: string | null,
): Promise<PaletteCommand> {
  let targetIds: string[] = []
  let targetSummary: string | null = null
  if (targetQ) {
    const probe = await prisma.fl_Device.findFirst({
      where: { clientName: { contains: targetQ, mode: "insensitive" } },
      select: { clientName: true },
    })
    const tenantName = probe?.clientName ?? targetQ
    const matched = await resolveTargets(tenantName, targetQ)
    targetIds = matched.ids.slice(0, 200)
    targetSummary = matched.summary
  } else {
    const missing = await prisma.fl_PatchInstall.findMany({
      where: { patchId: patch.id, state: "missing" },
      select: { deviceId: true },
      take: 200,
    })
    targetIds = missing.map((m) => m.deviceId)
    targetSummary = `${missing.length} affected host${missing.length === 1 ? "" : "s"}`
  }

  const params = new URLSearchParams({
    patchId: patch.id,
    ...(targetIds.length > 0 && { targets: targetIds.join(",") }),
  })
  return {
    id: `cmd:patch:${patch.id}:${matchToken}`,
    category: "Commands",
    label: `Deploy patch ${patch.sourceId}${targetSummary ? ` to ${targetSummary}` : ""}`,
    hint: `${isKev ? "🚨 KEV · " : ""}${patch.source} · ${patch.os} · ${patch.title.slice(0, 60)}${patch.title.length > 60 ? "…" : ""}`,
    href: `/deployments/new?${params.toString()}`,
    icon: patch.isHotpatch ? "⚡" : isKev ? "🚨" : "🔧",
  }
}

function parseCveListInline(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === "string")
  } catch {
    return []
  }
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

// ─── triage ───────────────────────────────────────────────────────────────

// Aliases for friendlier typing. Severity values mirror SEVERITY_FILTERS;
// signals mirror SIGNAL_FILTERS, both defined in lib/msp-rollup.
const SIGNAL_ALIASES: Record<string, string> = {
  alerts: "alerts",
  alert: "alerts",
  offline: "offline",
  off: "offline",
  patches: "patches",
  patch: "patches",
  deploys: "deploys",
  deploy: "deploys",
  scripts: "scripts",
  script: "scripts",
  schedules: "schedules",
  schedule: "schedules",
  audit: "audit",
  chain: "audit",
}
const SEVERITY_ALIASES: Record<string, string> = {
  critical: "critical-only",
  crit: "critical-only",
  "critical-only": "critical-only",
  warn: "warn+",
  "warn+": "warn+",
  warning: "warn+",
  info: "info+",
  "info+": "info+",
  all: "all",
}

async function resolveTriage(rest: string): Promise<PaletteCommand[]> {
  const q = rest.trim().toLowerCase()

  // Bare `triage` → open the dashboard with defaults.
  if (q.length === 0) {
    return [{
      id: "cmd:triage",
      category: "Commands" as const,
      label: "Open Triage",
      hint: "Cross-tenant MSP rollup at /msp",
      href: "/msp",
      icon: "🚨",
    }]
  }

  // Signal keyword?
  if (q in SIGNAL_ALIASES) {
    const signal = SIGNAL_ALIASES[q]
    return [{
      id: `cmd:triage:signal:${signal}`,
      category: "Commands" as const,
      label: `Triage — ${signal}`,
      hint: `Open /msp filtered to clients with non-zero ${signal}`,
      href: `/msp?signal=${signal}`,
      icon: "🚨",
    }]
  }

  // Severity keyword?
  if (q in SEVERITY_ALIASES) {
    const severity = SEVERITY_ALIASES[q]
    return [{
      id: `cmd:triage:severity:${severity}`,
      category: "Commands" as const,
      label: `Triage — ${severity}`,
      hint: `Open /msp with severity filter ${severity}`,
      href: `/msp?severity=${severity}`,
      icon: "🚨",
    }]
  }

  // Otherwise treat as a client-name fuzzy match. Pull the union of
  // Fl_Tenant.name + distinct Fl_Device.clientName (same source the
  // /msp table renders) and substring-match.
  const [tenants, devClients] = await Promise.all([
    prisma.fl_Tenant.findMany({ select: { name: true } }),
    prisma.fl_Device.findMany({
      where: { isActive: true },
      distinct: ["clientName"],
      select: { clientName: true },
    }),
  ])
  const names = new Set<string>()
  for (const t of tenants) names.add(t.name)
  for (const d of devClients) names.add(d.clientName)

  const matches = [...names].filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_PER_VERB)
  return matches.map((name) => {
    const slug = clientSlug(name)
    return {
      id: `cmd:triage:client:${slug}`,
      category: "Commands" as const,
      label: `Triage — ${name}`,
      hint: "Open /msp and scroll to this client",
      href: `/msp#client-${slug}`,
      icon: "🚨",
    }
  })
}

// ─── ack / escalate ──────────────────────────────────────────────────────

async function resolveAck(rest: string): Promise<PaletteCommand[]> {
  return resolveAlertVerb(rest, {
    verb: "ack",
    label: (a) => `Ack — ${a.title}`,
    hint: (a) => `${a.severity} · ${a.clientName} · open the alert page to ack`,
    href: (id) => `/alerts/${id}`,
    icon: "✓",
  })
}

async function resolveEscalate(rest: string): Promise<PaletteCommand[]> {
  return resolveAlertVerb(rest, {
    verb: "escalate",
    label: (a) => `Force escalate — ${a.title}`,
    hint: (a) => `${a.severity} · ${a.clientName} · jump the chain ahead`,
    href: (id) => `/alerts/${id}`,
    icon: "↑",
  })
}

interface AlertVerbSpec {
  verb: string
  label: (a: { title: string; clientName: string; severity: string }) => string
  hint: (a: { title: string; clientName: string; severity: string }) => string
  href: (id: string) => string
  icon: string
}

async function resolveAlertVerb(rest: string, spec: AlertVerbSpec): Promise<PaletteCommand[]> {
  const q = rest.trim().toLowerCase()
  if (q.length < 3) return []
  // Match by id prefix OR by title substring. Open alerts only —
  // acked / resolved alerts shouldn't surface in these verbs.
  const candidates = await prisma.fl_Alert.findMany({
    where: {
      state: "open",
      OR: [
        { id: { startsWith: q } },
        { title: { contains: q, mode: "insensitive" } },
        { clientName: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: MAX_PER_VERB,
    select: { id: true, title: true, clientName: true, severity: true },
  })
  return candidates.map((a) => ({
    id: `cmd:${spec.verb}:${a.id}`,
    category: "Commands" as const,
    label: spec.label(a),
    hint: spec.hint(a),
    href: spec.href(a.id),
    icon: spec.icon,
  }))
}

// ─── disable runbook / untrip ────────────────────────────────────────────

async function resolveRunbookVerb(
  rest: string,
  verb: "disable" | "untrip",
): Promise<PaletteCommand[]> {
  const q = rest.trim().toLowerCase()
  if (q.length < 2) return []

  // disable scope: any non-disabled runbook. The user clicks
  // Disable on the destination page.
  // untrip scope: tripped runbooks only — untripping a non-tripped
  // one is a no-op, so filtering to only-tripped at search time
  // saves the operator from picking a useless target.
  const candidates = await prisma.fl_Runbook.findMany({
    where: verb === "disable"
      ? {
          isActive: true,
          name: { contains: q, mode: "insensitive" },
        }
      : {
          isTripped: true,
          name: { contains: q, mode: "insensitive" },
        },
    orderBy: { name: "asc" },
    take: MAX_PER_VERB,
    select: { id: true, name: true, isTripped: true, isActive: true },
  })

  return candidates.map((r) => ({
    id: `cmd:${verb}:runbook:${r.id}`,
    category: "Commands" as const,
    label: verb === "disable" ? `Disable runbook — ${r.name}` : `Untrip runbook — ${r.name}`,
    hint: verb === "disable"
      ? "Open the runbook page to disable (stops new fires; history kept)"
      : "Open the runbook page to untrip (clears the circuit breaker)",
    href: `/runbooks/${r.id}`,
    icon: verb === "disable" ? "⏸" : "↻",
  }))
}

// ─── route <severity> <kind-glob> [client] ─────────────────────────────
//
// Pre-fills the new-route form. Severity is the first token; kind-glob
// is the next token; everything after that is the optional client name.
// Routes can be tenant-scoped or "all tenants" (null). When the client
// is given but doesn't match, we still emit a command with the client
// name as a raw tenantName param — operator sees the resolution miss
// in the form and can correct it.

const VALID_SEVERITIES = new Set(["critical", "warn", "info"])

async function resolveRouteVerb(rest: string[]): Promise<PaletteCommand[]> {
  const severity = rest[0]?.toLowerCase()
  if (!severity || !VALID_SEVERITIES.has(severity)) return []
  const kindLike = rest[1]
  if (!kindLike) return []
  const clientPart = rest.slice(2).join(" ").trim()
  const params = new URLSearchParams({
    severity,
    kindLike,
  })
  let tenantSummary = "every tenant"
  if (clientPart) {
    const tenant = await resolveTenantName(clientPart)
    if (tenant) {
      params.set("tenantName", tenant)
      tenantSummary = tenant
    } else {
      // No match — still pre-fill the raw string so the operator can see
      // the miss and pick from the dropdown.
      params.set("tenantName", clientPart)
      tenantSummary = `${clientPart} (no match)`
    }
  }
  return [
    {
      id: `cmd:route:${severity}:${kindLike}:${clientPart || "all"}`,
      category: "Commands" as const,
      label: `Route — ${severity} ${kindLike} → ${tenantSummary}`,
      hint: "Pre-fills /setup/alert-routing/new with severity, kind glob, and tenant",
      href: `/setup/alert-routing/new?${params.toString()}`,
      icon: "🚦",
    },
  ]
}

async function resolveTenantName(query: string): Promise<string | null> {
  const lower = query.trim().toLowerCase()
  // Try Fl_Tenant first; fall back to distinct Fl_Device.clientName.
  const tenant = await prisma.fl_Tenant.findFirst({
    where: { name: { contains: lower, mode: "insensitive" } },
    orderBy: { name: "asc" },
    select: { name: true },
  })
  if (tenant) return tenant.name
  const dev = await prisma.fl_Device.findFirst({
    where: {
      isActive: true,
      clientName: { contains: lower, mode: "insensitive" },
    },
    orderBy: { clientName: "asc" },
    select: { clientName: true },
  })
  return dev?.clientName ?? null
}

// ─── oncall <schedule-name> ─────────────────────────────────────────────

async function resolveOncallVerb(query: string): Promise<PaletteCommand[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const schedules = await prisma.fl_OncallSchedule.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: MAX_PER_VERB,
    select: { id: true, name: true, isActive: true },
  })
  return schedules.map((s) => ({
    id: `cmd:oncall:${s.id}`,
    category: "Commands" as const,
    label: `On-call — ${s.name}`,
    hint: s.isActive ? "Open the schedule editor" : "Inactive — open the schedule editor",
    href: `/setup/oncall-schedules/${s.id}`,
    icon: "📅",
  }))
}

// ─── enroll device — static OpsHub deep-link ───────────────────────────

function resolveEnrollDevice(): PaletteCommand[] {
  const opshubUrl = (process.env.OPSHUB_PUBLIC_URL || "https://opshub.pcc2k.com").replace(/\/$/, "")
  return [
    {
      id: "cmd:enroll-device",
      category: "Commands" as const,
      label: "Enroll device — OpsHub",
      hint: "Opens OpsHub /agents/new in a new tab",
      href: `${opshubUrl}/agents/new`,
      icon: "➕",
    },
  ]
}

// ─── enable portal / branding — both deep-link a tenant tab ────────────

async function resolveTenantTabVerb(
  query: string,
  tab: "settings" | "branding",
  hashAnchor: "portal" | "branding",
): Promise<PaletteCommand[]> {
  const q = query.trim()
  if (q.length < 1) return []
  const tenants = await prisma.fl_Tenant.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: MAX_PER_VERB,
    select: { name: true, portalEnabled: true },
  })
  // Fall back to distinct device-derived names when no Fl_Tenant matches.
  // Useful when a client only exists by virtue of having enrolled devices.
  if (tenants.length === 0) {
    const devs = await prisma.fl_Device.findMany({
      where: {
        isActive: true,
        clientName: { contains: q, mode: "insensitive" },
      },
      distinct: ["clientName"],
      orderBy: { clientName: "asc" },
      take: MAX_PER_VERB,
      select: { clientName: true },
    })
    return devs.map((d) => ({
      id: `cmd:${tab}:${d.clientName}`,
      category: "Commands" as const,
      label: tab === "settings"
        ? `Enable portal — ${d.clientName}`
        : `Branding — ${d.clientName}`,
      hint: `Open /clients/${d.clientName}?tab=${tab}#${hashAnchor}`,
      href: `/clients/${encodeURIComponent(d.clientName)}?tab=${tab}#${hashAnchor}`,
      icon: tab === "settings" ? "🌐" : "🎨",
    }))
  }
  return tenants.map((t) => {
    const portalHint =
      tab === "settings"
        ? t.portalEnabled
          ? "Portal currently ON — open settings to adjust"
          : "Portal currently OFF — open settings to enable"
        : "Open the branding tab"
    return {
      id: `cmd:${tab}:${t.name}`,
      category: "Commands" as const,
      label: tab === "settings" ? `Enable portal — ${t.name}` : `Branding — ${t.name}`,
      hint: portalHint,
      href: `/clients/${encodeURIComponent(t.name)}?tab=${tab}#${hashAnchor}`,
      icon: tab === "settings" ? "🌐" : "🎨",
    }
  })
}

// ─── rustdesk id <host> ────────────────────────────────────────────────

async function resolveRustdeskIdVerb(hostQuery: string): Promise<PaletteCommand[]> {
  const q = hostQuery.trim()
  if (q.length < 1) return []
  const devices = await prisma.fl_Device.findMany({
    where: {
      isActive: true,
      OR: [
        { hostname: { contains: q, mode: "insensitive" } },
        { ipAddress: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ isOnline: "desc" }, { lastSeenAt: "desc" }],
    take: MAX_PER_VERB,
    select: {
      id: true,
      hostname: true,
      clientName: true,
      rustdeskId: true,
    },
  })
  return devices.map((d) => ({
    id: `cmd:rustdesk-id:${d.id}`,
    category: "Commands" as const,
    label: `RustDesk ID — ${d.hostname}`,
    hint: d.rustdeskId
      ? `${d.clientName} · current ID: ${d.rustdeskId}`
      : `${d.clientName} · not yet set`,
    href: `/devices/${d.id}?tab=remote#rustdesk-id`,
    icon: "🖥",
  }))
}

// ─── monitor <q> ───────────────────────────────────────────────────────

async function resolveMonitorVerb(query: string): Promise<PaletteCommand[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const monitors = await prisma.fl_Monitor.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: MAX_PER_VERB,
    select: { id: true, name: true, severity: true, isActive: true, tenantName: true },
  })
  return monitors.map((m) => {
    const tenantSummary = m.tenantName ? m.tenantName : "all tenants"
    return {
      id: `cmd:monitor:${m.id}`,
      category: "Commands" as const,
      label: `Monitor — ${m.name}`,
      hint: m.isActive
        ? `${m.severity} · ${tenantSummary}`
        : `${m.severity} · ${tenantSummary} · disabled`,
      href: `/monitors/${m.id}`,
      icon: "📈",
    }
  })
}

// ─── inbound webhook <q> ──────────────────────────────────────────────

async function resolveInboundWebhookVerb(query: string): Promise<PaletteCommand[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const hooks = await prisma.fl_InboundWebhook.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { source: { contains: q, mode: "insensitive" } },
        { tenantName: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: MAX_PER_VERB,
    select: {
      id: true,
      name: true,
      source: true,
      tenantName: true,
      isActive: true,
      lastFiredAt: true,
    },
  })
  return hooks.map((h) => ({
    id: `cmd:inbound-webhook:${h.id}`,
    category: "Commands" as const,
    label: `Inbound webhook — ${h.name}`,
    hint: h.isActive
      ? `${h.source} · ${h.tenantName}${h.lastFiredAt ? ` · last ${h.lastFiredAt.toISOString().slice(0, 10)}` : " · never fired"}`
      : `${h.source} · ${h.tenantName} · disabled`,
    href: `/setup/inbound-webhooks#row-${h.id}`,
    icon: "📡",
  }))
}
