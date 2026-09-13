import { describe, expect, it } from "vitest"
import { controlrCorrelationId } from "@/lib/controlr"

describe("controlrCorrelationId", () => {
  it("is identity-safe (no colon, single-@ once ControlR appends @controlr.local)", () => {
    const id = controlrCorrelationId("msaville@pcc2k.com")
    expect(id).toBe("fleethub-msaville.at.pcc2k.com")
    expect(id).toMatch(/^[a-z0-9.-]+$/)
  })
  it("is stable and case-insensitive", () => {
    expect(controlrCorrelationId("Tech.One@PCC2K.com")).toBe(controlrCorrelationId("tech.one@pcc2k.com"))
  })
})
