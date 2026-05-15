import { NextRequest, NextResponse } from "next/server"
import { getSessionContext } from "@/lib/authz"
import {
  listMspRollup,
  SIGNAL_FILTERS,
  SEVERITY_FILTERS,
  type SignalFilter,
  type SeverityFilter,
} from "@/lib/msp-rollup"

// Phase 6 step 1 — JSON rollup for the upcoming /msp triage view +
// any external monitoring that wants to scrape fleet posture. The
// CSV sibling at /api/msp/export ships with step 9.
//
// Auth: NextAuth session OR a bearer FLEETHUB_AGENT_SECRET. Bearer
// path is what monitoring/cron scrapers use; session path is what
// the /msp page will use server-side once it lands in step 2.

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext()
  if (!ctx) {
    const auth = req.headers.get("authorization") ?? ""
    const secret = process.env.FLEETHUB_AGENT_SECRET ?? ""
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
  }
  // Scope filter hook for fleet_staff_client_scope — accepts a CSV in
  // ?scope=foo,bar. v1 has no per-user scope table, so callers can
  // pass an arbitrary allow-list; defaults to "all".
  const scopeParam = req.nextUrl.searchParams.get("scope")
  const scope =
    scopeParam && scopeParam.trim()
      ? scopeParam.split(",").map((s) => s.trim()).filter(Boolean)
      : "all"
  const signalRaw = req.nextUrl.searchParams.get("signal") ?? ""
  const severityRaw = req.nextUrl.searchParams.get("severity") ?? ""
  const signal = (SIGNAL_FILTERS as readonly string[]).includes(signalRaw)
    ? (signalRaw as SignalFilter)
    : "all"
  const severity = (SEVERITY_FILTERS as readonly string[]).includes(severityRaw)
    ? (severityRaw as SeverityFilter)
    : "warn+"
  const result = await listMspRollup({ scope, signal, severity })
  return NextResponse.json(result)
}
