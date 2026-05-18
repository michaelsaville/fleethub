import { describe, it, expect } from "vitest"
import { parseSavedViews, serializeSavedViews } from "../lib/saved-views"

// Phase 12 WS-E.7 — saved-views envelope. The {v: 1, views: [...]}
// shape is shipped FROM DAY ONE per architect §3.9 — these tests
// lock the schema before any consumer relies on a particular shape.

describe("parseSavedViews", () => {
  it("null → empty envelope", () => {
    expect(parseSavedViews(null)).toEqual({ v: 1, views: [] })
  })

  it("empty string → empty envelope", () => {
    expect(parseSavedViews("")).toEqual({ v: 1, views: [] })
  })

  it("malformed JSON → empty (no throw)", () => {
    expect(parseSavedViews("not json")).toEqual({ v: 1, views: [] })
  })

  it("wrong version → empty (drop-and-re-save policy)", () => {
    const out = parseSavedViews(JSON.stringify({ v: 2, views: [] }))
    expect(out).toEqual({ v: 1, views: [] })
  })

  it("missing views array → empty", () => {
    const out = parseSavedViews(JSON.stringify({ v: 1 }))
    expect(out).toEqual({ v: 1, views: [] })
  })

  it("valid envelope passes through", () => {
    const env = {
      v: 1,
      views: [
        {
          id: "v1",
          name: "Open critical",
          page: "alerts",
          filters: { severity: "critical", state: "open" },
        },
      ],
    }
    expect(parseSavedViews(JSON.stringify(env))).toEqual(env)
  })

  it("invalid page enum → empty (whole envelope rejected, not individual view filtering)", () => {
    const env = {
      v: 1,
      views: [{ id: "v1", name: "bad", page: "deployments", filters: {} }],
    }
    expect(parseSavedViews(JSON.stringify(env))).toEqual({ v: 1, views: [] })
  })

  it("view name length is capped at 60", () => {
    const longName = "x".repeat(61)
    const env = {
      v: 1,
      views: [{ id: "v1", name: longName, page: "alerts", filters: {} }],
    }
    expect(parseSavedViews(JSON.stringify(env))).toEqual({ v: 1, views: [] })
  })

  it("filters reject non-string values", () => {
    const env = {
      v: 1,
      views: [{ id: "v1", name: "x", page: "alerts", filters: { count: 5 } }],
    }
    expect(parseSavedViews(JSON.stringify(env))).toEqual({ v: 1, views: [] })
  })
})

describe("serializeSavedViews", () => {
  it("roundtrip parse(serialize(x)) === x", () => {
    const env = {
      v: 1 as const,
      views: [
        {
          id: "v1",
          name: "test",
          page: "devices" as const,
          filters: { os: "windows" },
          sort: { col: "hostname", dir: "asc" as const },
        },
      ],
    }
    const s = serializeSavedViews(env)
    expect(parseSavedViews(s)).toEqual(env)
  })
})
