import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth-options"
import { prisma } from "@/lib/prisma"
import { mockMode } from "@/lib/devices"
import { getMockAlertsAll, getMockDevices } from "@/lib/mock-fleet"

export const dynamic = "force-dynamic"

/**
 * Cmd-K palette search. Any signed-in staff can search; access control on
 * what they can DO with a result lives on the destination route.
 *
 * Phase 0 returns Entities (devices/scripts/alerts) + Recent (own audit
 * activity). Commands category is intentionally absent until the agent
 * ships — we'd rather show no commands than show fake ones that fail.
 */

interface PaletteResult {
  id: string
  category: "Entities" | "Recent"
  label: string
  hint?: string
  href: string
  icon?: string
}

const PER_CATEGORY = 5

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase()
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim()
  const wantEntities = q.length > 0

  const [devices, scripts, alerts, recent] = await Promise.all([
    wantEntities ? searchDevices(q) : Promise.resolve([] as PaletteResult[]),
    wantEntities ? searchScripts(q) : Promise.resolve([] as PaletteResult[]),
    wantEntities ? searchAlerts(q) : Promise.resolve([] as PaletteResult[]),
    recentForActor(email),
  ])

  // Interleave categories so a tech searching "acme" sees a device, a
  // script, and a related alert before all five devices.
  const entities: PaletteResult[] = []
  const buckets = [devices, scripts, alerts]
  let added = true
  while (added) {
    added = false
    for (const b of buckets) {
      const next = b.shift()
      if (next) {
        entities.push(next)
        added = true
      }
    }
  }

  return NextResponse.json({ entities, recent })
}

async function searchDevices(q: string): Promise<PaletteResult[]> {
  if (await mockMode()) {
    const needle = q.toLowerCase()
    const matched = getMockDevices().filter((d) =>
      d.hostname.toLowerCase().includes(needle) ||
      d.clientName.toLowerCase().includes(needle) ||
      (d.ipAddress ?? "").toLowerCase().includes(needle) ||
      (d.role ?? "").toLowerCase().includes(needle),
    ).slice(0, PER_CATEGORY)
    return matched.map((d) => ({
      id: `device:${d.id}`,
      category: "Entities" as const,
      label: d.hostname,
      hint: [d.clientName, d.role ?? d.os, d.isOnline ? "online" : "offline"]
        .filter(Boolean)
        .join(" · "),
      href: `/devices/${d.id}`,
      icon: "💻",
    }))
  }
  const rows = await prisma.fl_Device.findMany({
    where: {
      isActive: true,
      OR: [
        { hostname: { contains: q, mode: "insensitive" } },
        { clientName: { contains: q, mode: "insensitive" } },
        { ipAddress: { contains: q, mode: "insensitive" } },
        { role: { contains: q, mode: "insensitive" } },
      ],
    },
    take: PER_CATEGORY,
    orderBy: [{ isOnline: "desc" }, { lastSeenAt: "desc" }],
    select: {
      id: true,
      hostname: true,
      clientName: true,
      isOnline: true,
      os: true,
      role: true,
    },
  })
  return rows.map((d) => ({
    id: `device:${d.id}`,
    category: "Entities" as const,
    label: d.hostname,
    hint: [d.clientName, d.role ?? d.os, d.isOnline ? "online" : "offline"]
      .filter(Boolean)
      .join(" · "),
    href: `/devices/${d.id}`,
    icon: "💻",
  }))
}

async function searchScripts(q: string): Promise<PaletteResult[]> {
  const rows = await prisma.fl_Script.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
      ],
    },
    take: PER_CATEGORY,
    orderBy: [{ isCurated: "desc" }, { updatedAt: "desc" }],
    select: { id: true, name: true, shell: true, category: true, isCurated: true },
  })
  return rows.map((s) => ({
    id: `script:${s.id}`,
    category: "Entities" as const,
    label: s.name,
    hint: [s.shell, s.category, s.isCurated ? "curated" : "draft"]
      .filter(Boolean)
      .join(" · "),
    href: `/scripts/${s.id}`,
    icon: "⚡",
  }))
}

async function searchAlerts(q: string): Promise<PaletteResult[]> {
  if (await mockMode()) {
    const needle = q.toLowerCase()
    const matched = getMockAlertsAll().filter((a) =>
      a.title.toLowerCase().includes(needle) ||
      a.kind.toLowerCase().includes(needle),
    ).slice(0, PER_CATEGORY)
    return matched.map((a) => ({
      id: `alert:${a.id}`,
      category: "Entities" as const,
      label: a.title,
      hint: [a.clientName, a.severity, a.state].filter(Boolean).join(" · "),
      href: `/alerts/${a.id}`,
      icon: a.severity === "critical" ? "🚨" : "🔔",
    }))
  }
  const rows = await prisma.fl_Alert.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { kind: { contains: q, mode: "insensitive" } },
      ],
    },
    take: PER_CATEGORY,
    orderBy: [{ state: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      severity: true,
      state: true,
      clientName: true,
    },
  })
  return rows.map((a) => ({
    id: `alert:${a.id}`,
    category: "Entities" as const,
    label: a.title,
    hint: [a.clientName, a.severity, a.state].filter(Boolean).join(" · "),
    href: `/alerts/${a.id}`,
    icon: a.severity === "critical" ? "🚨" : "🔔",
  }))
}

async function recentForActor(actorEmail: string): Promise<PaletteResult[]> {
  const rows = await prisma.fl_AuditLog.findMany({
    where: { actorEmail },
    orderBy: { createdAt: "desc" },
    take: PER_CATEGORY,
    select: { id: true, action: true, deviceId: true, clientName: true, createdAt: true },
  })
  return rows.map((r) => {
    const target = r.deviceId
      ? { href: `/devices/${r.deviceId}`, label: r.deviceId }
      : r.clientName
      ? { href: `/clients/${encodeURIComponent(r.clientName)}`, label: r.clientName }
      : { href: "/", label: r.action }
    return {
      id: `recent:${r.id}`,
      category: "Recent" as const,
      label: target.label,
      hint: `${r.action} · ${relativeTime(r.createdAt)}`,
      href: target.href,
      icon: "🕘",
    }
  })
}

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
