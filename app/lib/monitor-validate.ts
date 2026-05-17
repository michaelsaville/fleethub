import "server-only"
import { SUPPORTED_METRICS } from "@/lib/monitor-evaluator"

// Phase 8 Workstream A step 3 — validator for new-monitor payloads.
// Keeps the API route thin; returns a structured discriminated result
// so the route can echo the operator's first mistake without a
// generic 400.

export interface MonitorPayload {
  name: string
  tenantName: string | null
  metric: string
  predicate: {
    operator: "lt" | "gt" | "eq" | "neq"
    value: number
    osFilter?: "windows" | "linux" | "darwin"
    deviceTag?: string
    forMin?: number
  }
  severity: "critical" | "warn" | "info"
  emitKind: string
  cooldownMin: number
  isActive: boolean
}

export type ValidateResult =
  | ({ ok: true } & MonitorPayload)
  | { ok: false; reason: string }

const VALID_OPS = new Set(["lt", "gt", "eq", "neq"])
const VALID_OS = new Set(["windows", "linux", "darwin"])
const VALID_SEVERITY = new Set(["critical", "warn", "info"])
const EMIT_KIND_RE = /^[a-z0-9._-]+$/

export function validateMonitorPayload(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "Body must be a JSON object" }
  }
  const r = raw as Record<string, unknown>

  const name = typeof r.name === "string" ? r.name.trim() : ""
  if (!name) return { ok: false, reason: "name is required" }
  if (name.length > 120) return { ok: false, reason: "name must be 120 characters or fewer" }

  const tenantNameRaw = r.tenantName
  let tenantName: string | null
  if (tenantNameRaw === null || tenantNameRaw === undefined || tenantNameRaw === "") {
    tenantName = null
  } else if (typeof tenantNameRaw === "string") {
    tenantName = tenantNameRaw.trim() || null
  } else {
    return { ok: false, reason: "tenantName must be a string or null" }
  }

  const metric = typeof r.metric === "string" ? r.metric : ""
  if (!SUPPORTED_METRICS.includes(metric)) {
    return { ok: false, reason: `metric must be one of: ${SUPPORTED_METRICS.join(", ")}` }
  }

  const pRaw = r.predicate
  if (!pRaw || typeof pRaw !== "object") {
    return { ok: false, reason: "predicate object required" }
  }
  const p = pRaw as Record<string, unknown>
  const operator = typeof p.operator === "string" ? p.operator : ""
  if (!VALID_OPS.has(operator)) {
    return { ok: false, reason: 'predicate.operator must be "lt", "gt", "eq", or "neq"' }
  }
  if (typeof p.value !== "number" || !Number.isFinite(p.value)) {
    return { ok: false, reason: "predicate.value must be a finite number" }
  }
  let osFilter: "windows" | "linux" | "darwin" | undefined
  if (p.osFilter !== undefined && p.osFilter !== null && p.osFilter !== "") {
    if (typeof p.osFilter !== "string" || !VALID_OS.has(p.osFilter)) {
      return { ok: false, reason: 'predicate.osFilter must be "windows", "linux", "darwin", or empty' }
    }
    osFilter = p.osFilter as "windows" | "linux" | "darwin"
  }
  let deviceTag: string | undefined
  if (p.deviceTag !== undefined && p.deviceTag !== null && p.deviceTag !== "") {
    if (typeof p.deviceTag !== "string") {
      return { ok: false, reason: "predicate.deviceTag must be a string" }
    }
    deviceTag = p.deviceTag.trim() || undefined
  }
  let forMin: number | undefined
  if (p.forMin !== undefined && p.forMin !== null) {
    if (typeof p.forMin !== "number" || !Number.isFinite(p.forMin) || p.forMin < 1 || p.forMin > 1440) {
      return { ok: false, reason: "predicate.forMin must be between 1 and 1440" }
    }
    forMin = Math.round(p.forMin)
  }

  const severity = typeof r.severity === "string" ? r.severity : ""
  if (!VALID_SEVERITY.has(severity)) {
    return { ok: false, reason: 'severity must be "critical", "warn", or "info"' }
  }

  let emitKind = typeof r.emitKind === "string" ? r.emitKind.trim() : ""
  if (!emitKind) {
    // Default — sanitize the name into a dotted slug behind a stable
    // prefix so route matching is predictable when the operator
    // didn't write a custom kind.
    emitKind = `monitor.${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled"}`
  }
  if (!EMIT_KIND_RE.test(emitKind)) {
    return {
      ok: false,
      reason: "emitKind must be lowercase letters, digits, dots, underscores, or dashes",
    }
  }
  if (emitKind.length > 100) {
    return { ok: false, reason: "emitKind must be 100 characters or fewer" }
  }

  let cooldownMin: number
  if (r.cooldownMin === undefined || r.cooldownMin === null) {
    cooldownMin = 30
  } else if (typeof r.cooldownMin !== "number" || !Number.isFinite(r.cooldownMin) || r.cooldownMin < 0 || r.cooldownMin > 1440) {
    return { ok: false, reason: "cooldownMin must be between 0 and 1440" }
  } else {
    cooldownMin = Math.round(r.cooldownMin)
  }

  const isActive = r.isActive === false ? false : true

  return {
    ok: true,
    name,
    tenantName,
    metric,
    predicate: { operator: operator as "lt" | "gt" | "eq" | "neq", value: p.value as number, osFilter, deviceTag, forMin },
    severity: severity as "critical" | "warn" | "info",
    emitKind,
    cooldownMin,
    isActive,
  }
}
