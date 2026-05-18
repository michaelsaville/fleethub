import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { matchesAlert, type MatchPredicate } from "@/lib/alert-match"

// Phase 9 WS-A §3.5 — match-preview endpoint.
//
// AlertRoute / Runbook / Monitor wizards POST a match shape and get
// back "would have matched N alerts in last 7 days" + 3 samples. Pure
// read-only; ADMIN-only since the response leaks alert titles.

export const dynamic = "force-dynamic"

interface PreviewBody {
  severity?: string[]
  kindLike?: string
}

const SEVS = new Set(["critical", "warn", "info"])

export async function POST(req: NextRequest) {
  await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as PreviewBody

  const predicate: MatchPredicate = {}
  if (Array.isArray(body.severity)) {
    const filtered = body.severity.filter((s) => SEVS.has(s)) as ("critical" | "warn" | "info")[]
    if (filtered.length > 0) predicate.severity = filtered
  }
  if (typeof body.kindLike === "string" && body.kindLike.trim()) {
    predicate.kindLike = body.kindLike.trim()
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000)
  // Pre-narrow by severity at the DB level when possible (cheaper than
  // a full table scan). kindLike is a glob — applied in-memory by
  // matchesAlert. With 7-day window the row count is bounded.
  const candidates = await prisma.fl_Alert.findMany({
    where: {
      createdAt: { gte: sevenDaysAgo },
      ...(predicate.severity && predicate.severity.length > 0
        ? { severity: { in: predicate.severity as string[] } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      kind: true,
      severity: true,
      title: true,
      createdAt: true,
      clientName: true,
      deviceId: true,
    },
  })

  const matched = candidates.filter((a) =>
    // matchesAlert only reads kind + severity off the alert; cast
    // the partial shape since we don't need the full Fl_Alert row.
    matchesAlert(predicate, a as unknown as Parameters<typeof matchesAlert>[1]),
  )
  return NextResponse.json({
    matchCount: matched.length,
    examined: candidates.length,
    windowDays: 7,
    samples: matched.slice(0, 3).map((a) => ({
      id: a.id,
      kind: a.kind,
      severity: a.severity,
      title: a.title,
      firedAt: a.createdAt.toISOString(),
      clientName: a.clientName,
    })),
    truncated: candidates.length >= 500,
  })
}
