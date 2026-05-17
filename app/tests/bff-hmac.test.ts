import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"
import { verifyHmac } from "../lib/bff-hmac"
import { hmacBase64, hmacHex, safeEqualBase64, safeEqualHex } from "../lib/hmac"

const SECRET = "test-secret-do-not-use-in-prod"

function signedHeaders(body: string, ts: number = Date.now()) {
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")
  return { sig: `sha256=${sig}`, ts: String(ts) }
}

describe("verifyHmac", () => {
  it("accepts a correctly signed, fresh request", () => {
    const body = '{"hello":"world"}'
    const { sig, ts } = signedHeaders(body)
    expect(verifyHmac(body, sig, ts, SECRET)).toEqual({ ok: true })
  })

  it("rejects when secret is empty (server misconfigured)", () => {
    const r = verifyHmac("body", "sha256=00", "1", "")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(500)
  })

  it("rejects missing signature header", () => {
    const r = verifyHmac("body", null, String(Date.now()), SECRET)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(401)
  })

  it("rejects missing timestamp header", () => {
    const r = verifyHmac("body", "sha256=00", null, SECRET)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(401)
  })

  it("rejects unsupported signature format (no sha256= prefix)", () => {
    const ts = String(Date.now())
    const r = verifyHmac("body", "deadbeef", ts, SECRET)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unsupported signature format/)
  })

  it("rejects timestamp outside the ±5 min replay window", () => {
    const body = "{}"
    const old = Date.now() - 10 * 60_000
    const { sig } = signedHeaders(body, old)
    const r = verifyHmac(body, sig, String(old), SECRET)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/outside/)
  })

  it("rejects a tampered signature of the same length", () => {
    const body = '{"a":1}'
    const { ts } = signedHeaders(body)
    // 64 hex chars but wrong — same length so length-mismatch branch
    // doesn't short-circuit timing-safe compare.
    const tampered = "sha256=" + "0".repeat(64)
    const r = verifyHmac(body, tampered, ts, SECRET)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/signature mismatch/)
  })

  it("rejects a length-mismatched signature", () => {
    const body = '{"a":1}'
    const { ts } = signedHeaders(body)
    const r = verifyHmac(body, "sha256=abcd", ts, SECRET)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/signature mismatch/)
  })
})

describe("safeEqualBase64", () => {
  it("accepts a correctly base64-encoded digest", () => {
    const sig = hmacBase64("payload", SECRET)
    expect(safeEqualBase64(sig, sig)).toBe(true)
  })

  it("rejects a tampered same-length digest", () => {
    const sig = hmacBase64("payload", SECRET)
    const tampered = "A" + sig.slice(1)
    expect(safeEqualBase64(sig, tampered)).toBe(false)
  })

  it("rejects empty or null inputs", () => {
    expect(safeEqualBase64("", "abc")).toBe(false)
    expect(safeEqualBase64("abc", "")).toBe(false)
  })

  it("rejects a digest of a different body", () => {
    const a = hmacBase64("payload-a", SECRET)
    const b = hmacBase64("payload-b", SECRET)
    expect(safeEqualBase64(a, b)).toBe(false)
  })

  it("interop sanity: hex and base64 of the same body are equivalent under encoding", () => {
    const body = "datadog-inbound-test"
    const hex = hmacHex(body, SECRET)
    const b64 = hmacBase64(body, SECRET)
    expect(Buffer.from(hex, "hex").equals(Buffer.from(b64, "base64"))).toBe(true)
    expect(safeEqualHex(hex, hex)).toBe(true)
    expect(safeEqualBase64(b64, b64)).toBe(true)
  })
})
