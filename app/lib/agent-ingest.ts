import "server-only"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

/**
 * Phase 1 ingest handlers. The WSS gateway terminates JSON-RPC + mTLS
 * and forwards a flat HTTP envelope here; FleetHub never speaks WSS
 * directly. The synthetic-agent script in repo root posts the same
 * envelope shape for dev testing.
 *
 * Methods supported in Phase 1:
 *   - inventory.report   agent → server (full snapshot, no delta yet)
 *   - agent.heartbeat    agent → server (just liveness)
 *   - alert.fire         agent → server (transition into a failed check)
 *
 * Anything else surfaces -32601 method-not-supported back to the caller.
 *
 * Method semantics + payload shapes match docs/AGENT-PROTOCOL.md and
 * the InventorySnapshot type in lib/devices.ts. Agents that drift from
 * those shapes are rejected at the zod boundary.
 */

const inventorySnapshot = z.object({
  hardware: z.object({
    manufacturer: z.string(),
    model: z.string(),
    serial: z.string(),
    cpu: z.string(),
    ramGb: z.number(),
    diskGb: z.number(),
    diskFreeGb: z.number(),
    biosVersion: z.string(),
    biosDate: z.string(),
    purchaseDate: z.string(),
  }),
  os: z.object({
    family: z.enum(["windows", "linux", "darwin"]),
    version: z.string(),
    build: z.string(),
    installedAt: z.string(),
    lastBootAt: z.string(),
    timezone: z.string(),
  }),
  patches: z.object({
    lastChecked: z.string(),
    pending: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  software: z.object({
    totalInstalled: z.number().int().nonnegative(),
    sample: z.array(z.string()),
  }),
  health: z.object({
    cpu7d: z.number(),
    ramPct: z.number(),
    diskPct: z.number(),
  }),
})

const deviceFacts = z.object({
  clientName: z.string().min(1),
  hostname: z.string().min(1),
  os: z.enum(["windows", "linux", "darwin"]).optional(),
  osVersion: z.string().optional(),
  ipAddress: z.string().optional(),
  role: z.string().optional(),
})
type DeviceFacts = z.infer<typeof deviceFacts>

const heartbeatDevice = deviceFacts.pick({ clientName: true, hostname: true })

const inventoryReport = z.object({
  method: z.literal("inventory.report"),
  agentId: z.string().min(1),
  ts: z.string(),
  device: deviceFacts,
  inventory: inventorySnapshot,
})

const heartbeat = z.object({
  method: z.literal("agent.heartbeat"),
  agentId: z.string().min(1),
  ts: z.string(),
  device: heartbeatDevice,
})

const alertFire = z.object({
  method: z.literal("alert.fire"),
  agentId: z.string().min(1),
  ts: z.string(),
  device: heartbeatDevice,
  alert: z.object({
    kind: z.string().min(1),
    severity: z.enum(["info", "warn", "critical"]),
    title: z.string().min(1),
    detail: z.unknown().optional(),
  }),
})

const envelope = z.discriminatedUnion("method", [inventoryReport, heartbeat, alertFire])

export type AgentEnvelope = z.infer<typeof envelope>

export interface IngestResult {
  method: AgentEnvelope["method"]
  deviceId: string
  alertId?: string
}

export class MethodNotSupportedError extends Error {
  constructor(method: string) {
    super(`method not supported: ${method}`)
    this.name = "MethodNotSupportedError"
  }
}

export async function handleAgentEnvelope(raw: unknown): Promise<IngestResult> {
  const parsed = envelope.safeParse(raw)
  if (!parsed.success) {
    if (
      typeof raw === "object" &&
      raw !== null &&
      "method" in raw &&
      typeof (raw as { method: unknown }).method === "string"
    ) {
      const m = (raw as { method: string }).method
      const supported: AgentEnvelope["method"][] = [
        "inventory.report",
        "agent.heartbeat",
        "alert.fire",
      ]
      if (!supported.includes(m as AgentEnvelope["method"])) {
        throw new MethodNotSupportedError(m)
      }
    }
    throw new Error(`envelope-validation: ${parsed.error.issues[0]?.message ?? "invalid"}`)
  }
  switch (parsed.data.method) {
    case "inventory.report":
      return handleInventoryReport(parsed.data)
    case "agent.heartbeat":
      return handleHeartbeat(parsed.data)
    case "alert.fire":
      return handleAlertFire(parsed.data)
  }
}

async function upsertDevice(args: {
  facts: DeviceFacts | z.infer<typeof heartbeatDevice>
  agentId: string
  inventoryJson?: string
  isOnline?: boolean
}): Promise<{ id: string }> {
  const { facts, agentId } = args
  const existing = await prisma.fl_Device.findUnique({
    where: { clientName_hostname: { clientName: facts.clientName, hostname: facts.hostname } },
    select: { id: true },
  })
  const data = {
    agentId,
    isOnline: args.isOnline ?? true,
    lastSeenAt: new Date(),
    ...("os" in facts && facts.os ? { os: facts.os } : {}),
    ...("osVersion" in facts && facts.osVersion ? { osVersion: facts.osVersion } : {}),
    ...("ipAddress" in facts && facts.ipAddress ? { ipAddress: facts.ipAddress } : {}),
    ...("role" in facts && facts.role ? { role: facts.role } : {}),
    ...(args.inventoryJson ? { inventoryJson: args.inventoryJson } : {}),
  }
  if (existing) {
    await prisma.fl_Device.update({ where: { id: existing.id }, data })
    return existing
  }
  const created = await prisma.fl_Device.create({
    data: {
      clientName: facts.clientName,
      hostname: facts.hostname,
      ...data,
    },
    select: { id: true },
  })
  return created
}

async function handleInventoryReport(env: z.infer<typeof inventoryReport>): Promise<IngestResult> {
  const device = await upsertDevice({
    facts: env.device,
    agentId: env.agentId,
    inventoryJson: JSON.stringify(env.inventory),
    isOnline: true,
  })
  await writeAudit({
    deviceId: device.id,
    clientName: env.device.clientName,
    action: "inventory.report",
    outcome: "ok",
    detail: {
      apps: env.inventory.software.totalInstalled,
      pendingPatches: env.inventory.patches.pending,
      diskFreeGb: env.inventory.hardware.diskFreeGb,
      ramPct: env.inventory.health.ramPct,
    },
  })
  return { method: "inventory.report", deviceId: device.id }
}

async function handleHeartbeat(env: z.infer<typeof heartbeat>): Promise<IngestResult> {
  const device = await upsertDevice({
    facts: env.device,
    agentId: env.agentId,
    isOnline: true,
  })
  return { method: "agent.heartbeat", deviceId: device.id }
}

async function handleAlertFire(env: z.infer<typeof alertFire>): Promise<IngestResult> {
  const device = await upsertDevice({
    facts: env.device,
    agentId: env.agentId,
    isOnline: true,
  })
  const alert = await prisma.fl_Alert.create({
    data: {
      clientName: env.device.clientName,
      deviceId: device.id,
      kind: env.alert.kind,
      severity: env.alert.severity,
      title: env.alert.title,
      detailJson: env.alert.detail === undefined ? null : JSON.stringify(env.alert.detail),
      state: "open",
    },
    select: { id: true },
  })
  await writeAudit({
    deviceId: device.id,
    clientName: env.device.clientName,
    action: "alert.fire",
    outcome: env.alert.severity === "critical" ? "error" : "pending",
    detail: { kind: env.alert.kind, title: env.alert.title, alertId: alert.id },
  })
  return { method: "alert.fire", deviceId: device.id, alertId: alert.id }
}
