import { describe, it, expect, vi } from "vitest"
import { submitWithApproval } from "../lib/client/submit-with-approval"

// Phase 12 WS-E.7 — discriminated-union return shapes. The 7 routes
// returning 202+approvalId today (Phase 11) all share this helper
// in Phase 12; pinning the return shape now prevents silent-success
// regressions.

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string, _init?: unknown) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    })
  }) as unknown as typeof fetch
}

describe("submitWithApproval", () => {
  it("200 with JSON → ok", async () => {
    const r = await submitWithApproval("/x", {
      body: { a: 1 },
      fetchImpl: mockFetch(200, { ok: true, data: 42 }),
    })
    expect(r.kind).toBe("ok")
  })

  it("202 + approval-required envelope → approval-required", async () => {
    const r = await submitWithApproval("/x", {
      body: {},
      fetchImpl: mockFetch(202, {
        status: "approval-required",
        approvalId: "appr-123",
        reason: ">50 devices",
      }),
    })
    expect(r.kind).toBe("approval-required")
    if (r.kind === "approval-required") {
      expect(r.approvalId).toBe("appr-123")
      expect(r.reason).toBe(">50 devices")
    }
  })

  it("202 without envelope → ok (route is async-but-accepted)", async () => {
    const r = await submitWithApproval("/x", {
      body: {},
      fetchImpl: mockFetch(202, { foo: "bar" }),
    })
    expect(r.kind).toBe("ok")
  })

  it("4xx → error with parsed message", async () => {
    const r = await submitWithApproval("/x", {
      body: {},
      fetchImpl: mockFetch(400, { error: "validation failed" }),
    })
    expect(r.kind).toBe("error")
    if (r.kind === "error") {
      expect(r.status).toBe(400)
      expect(r.message).toBe("validation failed")
    }
  })

  it("5xx with no JSON body → error with HTTP status", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch
    const r = await submitWithApproval("/x", { body: {}, fetchImpl })
    expect(r.kind).toBe("error")
    if (r.kind === "error") {
      expect(r.status).toBe(500)
      expect(r.message).toContain("500")
    }
  })

  it("approvalId is merged into body on the second submit", async () => {
    let capturedBody: string | null = null
    const fetchImpl = vi.fn(async (_url: string, init?: { body?: BodyInit }) => {
      capturedBody = typeof init?.body === "string" ? init.body : null
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
    await submitWithApproval("/x", {
      body: { deviceIds: ["a", "b"] },
      approvalId: "appr-1",
      fetchImpl,
    })
    expect(capturedBody).not.toBeNull()
    const parsed = JSON.parse(capturedBody!) as Record<string, unknown>
    expect(parsed).toEqual({ deviceIds: ["a", "b"], approvalId: "appr-1" })
  })

  it("stepUpToken sets X-FleetHub-StepUp header", async () => {
    let capturedHeader: string | null = null
    const fetchImpl = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      capturedHeader = init?.headers?.["X-FleetHub-StepUp"] ?? null
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
    await submitWithApproval("/x", { body: {}, stepUpToken: "step-up-abc", fetchImpl })
    expect(capturedHeader).toBe("step-up-abc")
  })

  it("method default is POST; respected when overridden", async () => {
    let capturedMethod: string | null = null
    const fetchImpl = vi.fn(async (_url: string, init?: { method?: string }) => {
      capturedMethod = init?.method ?? null
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
    await submitWithApproval("/x", { body: {}, fetchImpl })
    expect(capturedMethod).toBe("POST")
    capturedMethod = null
    await submitWithApproval("/x", { method: "PATCH", body: {}, fetchImpl })
    expect(capturedMethod).toBe("PATCH")
  })
})
