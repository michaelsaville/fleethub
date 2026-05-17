import { describe, it, expect } from "vitest"
import { matchesAlert, parseEscalationChain } from "../lib/alert-match"
import type { Fl_Alert } from "@prisma/client"

function alert(over: Partial<Fl_Alert> = {}): Fl_Alert {
  return {
    id: "a_1",
    clientName: "Acme",
    deviceId: null,
    kind: "disk.full",
    severity: "warn",
    title: "Disk full",
    detailJson: null,
    state: "open",
    ackedBy: null,
    ackedAt: null,
    resolvedAt: null,
    createdAt: new Date(),
    ...over,
  }
}

describe("matchesAlert", () => {
  it("empty predicate matches every alert", () => {
    expect(matchesAlert({}, alert())).toBe(true)
  })

  it("severity wildcard matches every alert", () => {
    expect(matchesAlert({ severity: "*" }, alert({ severity: "critical" }))).toBe(true)
    expect(matchesAlert({ severity: "*" }, alert({ severity: "info" }))).toBe(true)
  })

  it("severity string matches exact only", () => {
    expect(matchesAlert({ severity: "warn" }, alert({ severity: "warn" }))).toBe(true)
    expect(matchesAlert({ severity: "warn" }, alert({ severity: "critical" }))).toBe(false)
  })

  it("severity array matches inclusion", () => {
    const p = { severity: ["critical", "warn"] }
    expect(matchesAlert(p, alert({ severity: "warn" }))).toBe(true)
    expect(matchesAlert(p, alert({ severity: "critical" }))).toBe(true)
    expect(matchesAlert(p, alert({ severity: "info" }))).toBe(false)
  })

  it("kindLike exact (no wildcard) requires exact match", () => {
    const p = { kindLike: "disk.full" }
    expect(matchesAlert(p, alert({ kind: "disk.full" }))).toBe(true)
    expect(matchesAlert(p, alert({ kind: "disk.failing" }))).toBe(false)
  })

  it("kindLike with trailing wildcard matches prefix", () => {
    const p = { kindLike: "disk.*" }
    expect(matchesAlert(p, alert({ kind: "disk.full" }))).toBe(true)
    expect(matchesAlert(p, alert({ kind: "disk.failing" }))).toBe(true)
    expect(matchesAlert(p, alert({ kind: "cpu.high" }))).toBe(false)
  })

  it("kindLike is case-insensitive", () => {
    expect(matchesAlert({ kindLike: "DISK.*" }, alert({ kind: "disk.full" }))).toBe(true)
  })

  it("kindLike escapes regex metachars in the literal portion", () => {
    expect(matchesAlert({ kindLike: "disk[1].full" }, alert({ kind: "disk[1].full" }))).toBe(true)
    expect(matchesAlert({ kindLike: "disk[1].full" }, alert({ kind: "disk1.full" }))).toBe(false)
  })

  it("severity AND kindLike must both match", () => {
    const p = { severity: ["warn"], kindLike: "disk.*" }
    expect(matchesAlert(p, alert({ severity: "warn", kind: "disk.full" }))).toBe(true)
    expect(matchesAlert(p, alert({ severity: "critical", kind: "disk.full" }))).toBe(false)
    expect(matchesAlert(p, alert({ severity: "warn", kind: "cpu.high" }))).toBe(false)
  })
})

describe("parseEscalationChain", () => {
  it("null/empty returns []", () => {
    expect(parseEscalationChain(null)).toEqual([])
    expect(parseEscalationChain("")).toEqual([])
  })

  it("invalid JSON returns []", () => {
    expect(parseEscalationChain("{not json")).toEqual([])
  })

  it("non-array JSON returns []", () => {
    expect(parseEscalationChain('{"afterMin":5}')).toEqual([])
  })

  it("valid chain parses with types narrowed", () => {
    const json = JSON.stringify([
      { afterMin: 5, channels: [{ type: "slack" }] },
      { afterMin: 15, channels: [{ type: "email" }] },
    ])
    const r = parseEscalationChain(json)
    expect(r).toHaveLength(2)
    expect(r[0].afterMin).toBe(5)
    expect(r[1].channels[0].type).toBe("email")
  })

  it("skips steps missing afterMin", () => {
    const json = JSON.stringify([
      { channels: [{ type: "slack" }] },
      { afterMin: 5, channels: [{ type: "slack" }] },
    ])
    const r = parseEscalationChain(json)
    expect(r).toHaveLength(1)
    expect(r[0].afterMin).toBe(5)
  })

  it("skips steps with non-positive afterMin", () => {
    const json = JSON.stringify([
      { afterMin: 0, channels: [{ type: "slack" }] },
      { afterMin: -5, channels: [{ type: "slack" }] },
      { afterMin: 5, channels: [{ type: "slack" }] },
    ])
    const r = parseEscalationChain(json)
    expect(r).toHaveLength(1)
  })

  it("skips steps with non-array channels", () => {
    const json = JSON.stringify([
      { afterMin: 5, channels: "not-an-array" },
      { afterMin: 10, channels: [{ type: "slack" }] },
    ])
    const r = parseEscalationChain(json)
    expect(r).toHaveLength(1)
    expect(r[0].afterMin).toBe(10)
  })
})
