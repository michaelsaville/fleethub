import { describe, it, expect } from "vitest"
import { validateRoutePayload } from "../lib/alert-route-validate"
import { validateRunbookPayload } from "../lib/runbook-validate"
import { validateSchedulePayload } from "../lib/oncall-validate"
import { validateMonitorPayload } from "../lib/monitor-validate"

// Phase 8 Workstream C §5.5 — validator tests. Each validator
// gets a happy-path + the most operator-visible failure branches.

describe("validateRoutePayload", () => {
  function base(): Record<string, unknown> {
    return {
      tenantName: "Acme",
      match: { severity: ["warn"], kindLike: "disk.*" },
      channels: [{ type: "slack", webhookUrl: "https://hooks.slack.com/services/A/B/C" }],
      dedupWindowMin: 15,
      priority: 100,
      isActive: true,
    }
  }

  it("accepts a minimal valid route", () => {
    const r = validateRoutePayload(base())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.tenantName).toBe("Acme")
      expect(r.channels.length).toBe(1)
      expect(r.match).toEqual({ severity: ["warn"], kindLike: "disk.*" })
    }
  })

  it("converts empty tenantName to null (all tenants)", () => {
    const r = validateRoutePayload({ ...base(), tenantName: "" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tenantName).toBe(null)
  })

  it("rejects route with no channels", () => {
    const r = validateRoutePayload({ ...base(), channels: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/channel/)
  })

  it("rejects a non-Slack-shaped Slack webhook URL", () => {
    const r = validateRoutePayload({
      ...base(),
      channels: [{ type: "slack", webhookUrl: "https://example.com/wat" }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/webhookUrl/)
  })

  it("rejects an SMS channel with a non-E.164 number", () => {
    const r = validateRoutePayload({
      ...base(),
      channels: [{ type: "sms", phoneNumbers: ["4155551234"] }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/E\.164/)
  })

  it("rejects a PagerDuty channel with a too-short integration key", () => {
    const r = validateRoutePayload({
      ...base(),
      channels: [{ type: "pagerduty", integrationKey: "tooshort" }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/integrationKey/)
  })

  it("accepts an email channel with only an oncallScheduleId (no static recipients)", () => {
    const r = validateRoutePayload({
      ...base(),
      channels: [{ type: "email", oncallScheduleId: "sched_abc" }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.channels[0]).toMatchObject({ type: "email", oncallScheduleId: "sched_abc" })
      expect(r.channels[0].toEmails).toBeUndefined()
    }
  })

  it("rejects more than 10 escalation steps", () => {
    const eleven = Array.from({ length: 11 }, () => ({
      afterMin: 5,
      channels: [{ type: "slack", webhookUrl: "https://hooks.slack.com/services/A/B/C" }],
    }))
    const r = validateRoutePayload({ ...base(), escalation: eleven })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/escalation|10/)
  })
})

describe("validateRunbookPayload", () => {
  function base(): Record<string, unknown> {
    return {
      name: "Disk cleanup runbook",
      scriptId: "scr_abc",
      match: { severity: ["warn"], kindLike: "disk.*" },
      graceMin: 2,
      cooldownMin: 30,
      maxFiresPerHour: 10,
      maxConsecutiveFailures: 3,
      isActive: true,
    }
  }

  it("accepts a minimal valid runbook", () => {
    const r = validateRunbookPayload(base())
    expect(r.ok).toBe(true)
  })

  it("rejects missing name", () => {
    const r = validateRunbookPayload({ ...base(), name: "" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/name/)
  })

  it("rejects missing scriptId", () => {
    const r = validateRunbookPayload({ ...base(), scriptId: "" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/scriptId/)
  })

  it("rejects an unbounded match (no severity AND no kindLike)", () => {
    const r = validateRunbookPayload({ ...base(), match: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unbounded/)
  })

  it("rejects dryRunPredicate that isn't valid JSON", () => {
    const r = validateRunbookPayload({ ...base(), dryRunPredicate: "{not json" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/JSON/)
  })

  it("accepts dryRunPredicate as a parsed object", () => {
    const r = validateRunbookPayload({ ...base(), dryRunPredicate: { exitCode: 0 } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.dryRunPredicateJson).toBe('{"exitCode":0}')
  })
})

describe("validateSchedulePayload", () => {
  function base(): Record<string, unknown> {
    return {
      name: "Ops primary",
      rotation: [{ userId: "u_1", dayOfWeek: 1, start: "08:00", end: "17:00" }],
      overrides: [],
      isActive: true,
    }
  }

  it("accepts a minimal valid schedule", () => {
    const r = validateSchedulePayload(base())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rotation).toHaveLength(1)
  })

  it("rejects a slot with dayOfWeek outside 0-6", () => {
    const r = validateSchedulePayload({
      ...base(),
      rotation: [{ userId: "u_1", dayOfWeek: 7, start: "08:00", end: "17:00" }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/dayOfWeek/)
  })

  it("rejects a slot with bad HH:MM", () => {
    const r = validateSchedulePayload({
      ...base(),
      rotation: [{ userId: "u_1", dayOfWeek: 1, start: "08:00", end: "25:00" }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/HH:MM/)
  })

  it("rejects an override where end <= start", () => {
    const r = validateSchedulePayload({
      ...base(),
      overrides: [
        { userId: "u_1", start: "2026-05-17T10:00:00Z", end: "2026-05-17T09:00:00Z" },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/AFTER/i)
  })
})

describe("validateMonitorPayload", () => {
  function base(): Record<string, unknown> {
    return {
      name: "Disk > 90",
      metric: "perf.disk.percent",
      predicate: { operator: "gt", value: 90, forMin: 15 },
      severity: "warn",
    }
  }

  it("accepts a minimal valid monitor + auto-derives emitKind from name", () => {
    const r = validateMonitorPayload(base())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.emitKind).toBe("monitor.disk-90")
      expect(r.cooldownMin).toBe(30)
    }
  })

  it("rejects an invalid operator", () => {
    const r = validateMonitorPayload({
      ...base(),
      predicate: { operator: "in", value: 90, forMin: 15 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/operator/)
  })

  it("rejects an unknown metric", () => {
    const r = validateMonitorPayload({ ...base(), metric: "perf.iops" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/metric/)
  })

  it("rejects an emitKind with unsupported characters", () => {
    const r = validateMonitorPayload({ ...base(), emitKind: "Disk Full!" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/emitKind/)
  })

  it("rejects forMin outside 1-1440", () => {
    const r = validateMonitorPayload({
      ...base(),
      predicate: { operator: "gt", value: 90, forMin: 0 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/forMin/)
  })
})
