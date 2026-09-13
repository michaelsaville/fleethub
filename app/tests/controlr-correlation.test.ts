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

import { controlrDisplayName } from "@/lib/controlr"
describe("controlrDisplayName", () => {
  it("only letters/digits/_/-/space, tagged FleetHub", () => {
    expect(controlrDisplayName("msaville@pcc2k.com", null)).toBe("msaville - FleetHub")
    expect(controlrDisplayName("x@y.z", "Mike O'Brien")).toBe("Mike O Brien - FleetHub")
  })
})
