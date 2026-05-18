import "server-only"

// Phase 13 / agent v1.0.2 WS-0c — shared capability string constants.
//
// AGENT-PROTOCOL.md §8 is the wire contract. Both ends (FleetHub +
// pcc2k-agent) must agree on the literal strings. Hardcoded strings
// in this repo create silent-drift risk — a single rename in the
// agent's `capabilities.go` would flip every FH-side capability-gated
// button to permanently-disabled with no test failure.
//
// Convention: every FH-side capability check imports from this
// constant. The typecheck enforces it (literal string typo can't
// match `AgentCapability`).
//
// When a new capability lands:
//   1. Edit AGENT-PROTOCOL.md §8 (the source of truth).
//   2. Add to this map (the FH-side mirror).
//   3. Add to pcc2k-agent's capabilities.go.

import { prisma } from "@/lib/prisma"

export const AGENT_CAPABILITIES = {
  /// Baseline — every enrolled agent has these.
  agent:     "agent",
  inventory: "inventory",
  alerts:    "alerts",

  /// v1.0.1 verb namespaces.
  shell:     "fleet.shell",   // shell.open / .input / .close
  file:      "fleet.file",    // file.push / .pull
  backup:    "fleet.backup",  // backup.trigger / .cancel (per-product detect)

  /// v1.0.2 verb namespaces.
  processes: "fleet.processes", // fleet.processes.list (all platforms)
  services:  "fleet.services",  // fleet.services.list / .start / .stop / .restart
                                // (linux + windows only; macOS uses
                                //  fleet.processes for list-only)
  av:        "fleet.av",        // fleet.av.scan / .update-defs / .quarantine
                                // / .release / .cancel (Defender only in v1.0)
} as const

export type AgentCapability =
  (typeof AGENT_CAPABILITIES)[keyof typeof AGENT_CAPABILITIES]

/** All declared capability strings as a Set — useful for round-trip
 *  validation of strings coming OFF the wire. */
export const ALL_AGENT_CAPABILITIES: ReadonlySet<string> = new Set(
  Object.values(AGENT_CAPABILITIES),
)

/** Type-safe membership check for inbound capability strings. */
export function isKnownCapability(s: string): s is AgentCapability {
  return ALL_AGENT_CAPABILITIES.has(s)
}

/** Read the live agent capability set for a device. Reads from
 *  Op_Agent.capabilities JSONB column (updated by capabilities.update
 *  notification — AGENT-PROTOCOL.md §23 — plus initial agent.hello).
 *  Returns the empty Set when the device has no agent enrolled.
 *
 *  Phase 13 UI button-gating: `if (caps.has(AGENT_CAPABILITIES.shell))
 *  renderShellButton()`. Disabled-with-tooltip is the architect-
 *  required UX when capability missing (NOT 502 on click). */
export async function agentCapabilitiesForDevice(
  deviceId: string,
): Promise<ReadonlySet<AgentCapability>> {
  const device = await prisma.fl_Device.findUnique({
    where: { id: deviceId },
    select: { agentId: true },
  })
  if (!device?.agentId) return new Set()
  // Op_Agent lives in opshub.* schema. Use $queryRawTyped cross-
  // schema read; we only need the capabilities column.
  type Row = { capabilities: unknown }
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT capabilities
    FROM opshub.op_agents
    WHERE id = ${device.agentId}
    LIMIT 1
  `
  const raw = rows[0]?.capabilities
  if (!raw || !Array.isArray(raw)) return new Set()
  const out = new Set<AgentCapability>()
  for (const s of raw as unknown[]) {
    if (typeof s === "string" && isKnownCapability(s)) {
      out.add(s)
    }
  }
  return out
}

/** Convenience: does device's agent advertise the named capability? */
export async function agentSupports(
  deviceId: string,
  cap: AgentCapability,
): Promise<boolean> {
  const caps = await agentCapabilitiesForDevice(deviceId)
  return caps.has(cap)
}
