import "server-only"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { onTargetCompleted } from "@/lib/deployments"

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
  network: z
    .object({
      interfaces: z
        .array(
          z.object({
            name: z.string(),
            mac: z.string().optional(),
            ipv4: z.array(z.string()).optional(),
            ipv6: z.array(z.string()).optional(),
            up: z.boolean(),
            speedMbps: z.number().optional(),
          }),
        )
        .default([]),
      listeningPorts: z
        .array(
          z.object({
            protocol: z.string(),
            address: z.string(),
            process: z.string().optional(),
          }),
        )
        .default([]),
      recentConnections: z
        .array(
          z.object({
            protocol: z.string(),
            local: z.string(),
            remote: z.string(),
            state: z.string(),
          }),
        )
        .default([]),
    })
    // Network is Phase 1.5 — older agents (and the synthetic harness)
    // don't include it. Default to an empty Network so the ingest
    // boundary stays backwards-compatible.
    .default({ interfaces: [], listeningPorts: [], recentConnections: [] }),
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

// Phase 2 — scripts.* notifications from agent.
// scripts.output is streamed in ≤4KiB chunks per AGENT-PROTOCOL §21.2.
// scripts.complete is the terminal frame per §21.3.
const scriptsOutput = z.object({
  method: z.literal("scripts.output"),
  agentId: z.string().min(1),
  ts: z.string(),
  commandId: z.string().min(1),
  stream: z.enum(["stdout", "stderr"]),
  seq: z.number().int().nonnegative(),
  data: z.string(),
})

const scriptsComplete = z.object({
  method: z.literal("scripts.complete"),
  agentId: z.string().min(1),
  ts: z.string(),
  commandId: z.string().min(1),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  outputUrl: z.string().nullish(),
  outputSha256: z.string().nullish(),
  exitMessage: z.string().nullish(),
})

// Phase 3 — software.* notifications from agent (AGENT-PROTOCOL §22.4/§22.5).
// commandId equals Fl_DeploymentTarget.id — agent uses whatever id the gateway
// dispatch passed it.
const softwareProgress = z.object({
  method: z.literal("software.progress"),
  agentId: z.string().min(1),
  ts: z.string(),
  commandId: z.string().min(1),
  // Phase per §22.4. Some frames carry only metadata (no stream chunk).
  phase: z.enum(["downloading", "extracting", "installing", "verifying", "rebooting"]).optional(),
  percent: z.number().int().min(0).max(100).optional(),
  message: z.string().optional(),
  // Streamed chunk frames carry stream + seq + data; metadata frames don't.
  stream: z.enum(["stdout", "stderr"]).optional(),
  seq: z.number().int().nonnegative().optional(),
  data: z.string().optional(),
})

const softwareComplete = z.object({
  method: z.literal("software.complete"),
  agentId: z.string().min(1),
  ts: z.string(),
  commandId: z.string().min(1),
  result: z.enum([
    "installed",
    "updated",
    "no-op",
    "failed",
    "reboot-required",
    "reboot-deferred",
  ]),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  detectedVersion: z.string().nullish(),
  rebootPending: z.boolean().optional(),
  stderrTail: z.string().nullish(),
  outputUrl: z.string().nullish(),
  outputSha256: z.string().nullish(),
})

// Phase 4 — patches.* notifications + report (AGENT-PROTOCOL §23.5 / §23.6).
// commandId on progress/complete = Fl_PatchInstall.id (or a transient id for
// scan that we de-correlate via patches.report).
const patchesProgress = z.object({
  method: z.literal("patches.progress"),
  agentId: z.string().min(1),
  ts: z.string(),
  commandId: z.string().min(1),
  phase: z.enum(["downloading", "extracting", "installing", "verifying", "rebooting"]).optional(),
  percent: z.number().int().min(0).max(100).optional(),
  message: z.string().optional(),
  stream: z.enum(["stdout", "stderr"]).optional(),
  seq: z.number().int().nonnegative().optional(),
  data: z.string().optional(),
})

const patchesComplete = z.object({
  method: z.literal("patches.complete"),
  agentId: z.string().min(1),
  ts: z.string(),
  commandId: z.string().min(1),
  result: z.enum([
    "installed",
    "no-op",
    "failed",
    "preflight-failed",
    "reboot-required",
    "reboot-deferred",
    "rolled-back",
    "rollback-failed",
    "rollback-partial",
    "detection-disagreement",
  ]),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  rebootPending: z.boolean().optional(),
  detectedVersion: z.string().nullish(),
  stderrTail: z.string().nullish(),
  preflightGateFailed: z.string().nullish(),
  detectionConsensus: z.enum(["all-yes", "all-no", "disagreement"]).optional(),
  perMethodDetection: z.record(z.string(), z.boolean()).optional(),
  rollbackStrategyUsed: z.string().nullish(),
})

// Agent → server notification when local Windows Update API surfaces a KB
// the catalog hasn't ingested yet. Cheap "minutes vs days" hint.
const patchesAdvisoryFire = z.object({
  method: z.literal("patches.advisory.fire"),
  agentId: z.string().min(1),
  ts: z.string(),
  kbId: z.string().min(1),
  publishedAt: z.string().optional(),
  classification: z.enum(["critical", "security", "rollup", "feature", "definition", "driver"]).optional(),
})

// patches.scan dispatches a scan; the agent posts back patches.report with
// the full enumerated list (large payload, kept off the response path).
const patchesReport = z.object({
  method: z.literal("patches.report"),
  agentId: z.string().min(1),
  ts: z.string(),
  commandId: z.string().min(1),
  installedCount: z.number().int().nonnegative().optional(),
  patches: z.array(z.object({
    source: z.string(),
    sourceId: z.string(),
    title: z.string().optional(),
    size: z.string().optional(),
    arch: z.string().optional(),
    repo: z.string().optional(),
    classification: z.string().optional(),
    availableVersion: z.string().optional(),
    installedVersion: z.string().optional(),
  })).optional(),
  error: z.string().optional(),
})

const envelope = z.discriminatedUnion("method", [
  inventoryReport,
  heartbeat,
  alertFire,
  scriptsOutput,
  scriptsComplete,
  softwareProgress,
  softwareComplete,
  patchesProgress,
  patchesComplete,
  patchesAdvisoryFire,
  patchesReport,
])

export type AgentEnvelope = z.infer<typeof envelope>

export interface IngestResult {
  method: AgentEnvelope["method"]
  deviceId: string
  alertId?: string
  commandId?: string
  state?: string
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
        "scripts.output",
        "scripts.complete",
        "software.progress",
        "software.complete",
        "patches.progress",
        "patches.complete",
        "patches.advisory.fire",
        "patches.report",
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
    case "scripts.output":
      return handleScriptsOutput(parsed.data)
    case "scripts.complete":
      return handleScriptsComplete(parsed.data)
    case "software.progress":
      return handleSoftwareProgress(parsed.data)
    case "software.complete":
      return handleSoftwareComplete(parsed.data)
    case "patches.progress":
      return handlePatchesProgress(parsed.data)
    case "patches.complete":
      return handlePatchesComplete(parsed.data)
    case "patches.advisory.fire":
      return handlePatchesAdvisoryFire(parsed.data)
    case "patches.report":
      return handlePatchesReport(parsed.data)
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

// ─── scripts.* handlers (Phase 2) ─────────────────────────────────────────
//
// Both notifications are keyed by commandId, which equals Fl_ScriptRun.id —
// the agent uses whatever id the gateway dispatch passed it. We append
// output chunks to the matching run, transitioning state queued → running
// on first chunk; completion lands the terminal state + exit code.

const RUN_OUTPUT_CAP_BYTES = 64 * 1024

async function handleScriptsOutput(env: z.infer<typeof scriptsOutput>): Promise<IngestResult> {
  const run = await prisma.fl_ScriptRun.findUnique({
    where: { id: env.commandId },
    select: { id: true, deviceId: true, state: true, output: true, stderr: true },
  })
  if (!run) {
    throw new Error(`scripts.output: unknown commandId ${env.commandId}`)
  }

  // Append, capped at RUN_OUTPUT_CAP_BYTES per stream. Anything past that
  // would land in S3 once Phase 5 storage is wired; for now we truncate.
  const existing = (env.stream === "stdout" ? run.output : run.stderr) ?? ""
  const room = Math.max(0, RUN_OUTPUT_CAP_BYTES - existing.length)
  const appended = room > 0 ? existing + env.data.slice(0, room) : existing

  // Conditional queued → running transition (check-and-set) so an
  // output chunk arriving concurrently with scripts.complete can't undo
  // a terminal state. Same pattern as software/patch progress handlers.
  await prisma.fl_ScriptRun.updateMany({
    where: { id: env.commandId, state: "queued" },
    data: { state: "running", startedAt: new Date() },
  })

  const update: Record<string, unknown> = {}
  update[env.stream === "stdout" ? "output" : "stderr"] = appended

  await prisma.fl_ScriptRun.update({ where: { id: env.commandId }, data: update })
  return { method: "scripts.output", deviceId: run.deviceId, commandId: env.commandId }
}

async function handleScriptsComplete(env: z.infer<typeof scriptsComplete>): Promise<IngestResult> {
  const run = await prisma.fl_ScriptRun.findUnique({
    where: { id: env.commandId },
    select: { id: true, deviceId: true, dryRun: true, startedAt: true, state: true },
  })
  if (!run) {
    throw new Error(`scripts.complete: unknown commandId ${env.commandId}`)
  }

  // Map exit code + exitMessage to terminal state per Fl_ScriptRun spec.
  let nextState: string
  if (run.dryRun) {
    nextState = "dryrun"
  } else if (env.exitMessage === "timeout") {
    nextState = "timeout"
  } else if (env.exitMessage === "cancelled" || run.state === "cancelled") {
    nextState = "cancelled"
  } else if (env.exitCode === 0) {
    nextState = "ok"
  } else {
    nextState = "error"
  }

  const finishedAt = new Date()
  await prisma.fl_ScriptRun.update({
    where: { id: env.commandId },
    data: {
      state: nextState,
      exitCode: env.exitCode,
      durationMs: env.durationMs,
      outputBytes: env.outputBytes,
      outputUrl: env.outputUrl ?? null,
      outputSha256: env.outputSha256 ?? null,
      finishedAt,
      // startedAt may have been stamped by handleScriptsOutput already;
      // backfill if no output ever came back.
      ...(run.startedAt ? {} : { startedAt: new Date(finishedAt.getTime() - env.durationMs) }),
    },
  })

  const device = await prisma.fl_Device.findUnique({
    where: { id: run.deviceId },
    select: { clientName: true },
  })
  await writeAudit({
    deviceId: run.deviceId,
    clientName: device?.clientName ?? null,
    action: "scripts.complete",
    outcome: nextState === "ok" || nextState === "dryrun" ? "ok" : "error",
    detail: {
      runId: env.commandId,
      exitCode: env.exitCode,
      durationMs: env.durationMs,
      outputBytes: env.outputBytes,
      state: nextState,
    },
  })

  return { method: "scripts.complete", deviceId: run.deviceId, commandId: env.commandId, state: nextState }
}

// ─── software.* handlers (Phase 3) ────────────────────────────────────────
//
// Both notifications are keyed by commandId = Fl_DeploymentTarget.id.
// software.progress streams the deploy-monitor "Downloading 12.4 / 26.1 MB"
// surface; software.complete is the terminal frame mapping result enum to
// Fl_DeploymentTarget.status. lib/deployments.ts:simulateAgentResponse() is
// the prior mock — these handlers replace it once dispatchToAgent is wired.

const TARGET_STDERR_TAIL_BYTES = 4 * 1024

async function handleSoftwareProgress(env: z.infer<typeof softwareProgress>): Promise<IngestResult> {
  const target = await prisma.fl_DeploymentTarget.findUnique({
    where: { id: env.commandId },
    select: { id: true, deviceId: true, status: true, stderrTail: true },
  })
  if (!target) {
    throw new Error(`software.progress: unknown commandId ${env.commandId}`)
  }

  // Conditional state transition (check-and-set) so a progress frame that
  // arrives concurrently with complete can't clobber the terminal status
  // — see the same fix in handlePatchesProgress for the why.
  await prisma.fl_DeploymentTarget.updateMany({
    where: { id: env.commandId, status: { in: ["pending", "dispatched"] } },
    data: { status: "running", startedAt: new Date() },
  })

  const update: Record<string, unknown> = {}
  if (env.message) update.progressMessage = env.message
  if (env.percent !== undefined) update.progressPercent = env.percent

  // Streamed stderr chunks accumulate into stderrTail (truncated to last
  // TARGET_STDERR_TAIL_BYTES). stdout chunks are dropped server-side for v1
  // — Phase 3.5 will pump them to S3 when the package emits enough volume.
  if (env.stream === "stderr" && env.data) {
    const existing = target.stderrTail ?? ""
    const merged = existing + env.data
    update.stderrTail =
      merged.length > TARGET_STDERR_TAIL_BYTES
        ? merged.slice(merged.length - TARGET_STDERR_TAIL_BYTES)
        : merged
  }

  if (Object.keys(update).length > 0) {
    await prisma.fl_DeploymentTarget.update({ where: { id: env.commandId }, data: update })
  }
  return { method: "software.progress", deviceId: target.deviceId, commandId: env.commandId }
}

async function handleSoftwareComplete(env: z.infer<typeof softwareComplete>): Promise<IngestResult> {
  const target = await prisma.fl_DeploymentTarget.findUnique({
    where: { id: env.commandId },
    select: { id: true, deviceId: true, deploymentId: true, startedAt: true, status: true },
  })
  if (!target) {
    throw new Error(`software.complete: unknown commandId ${env.commandId}`)
  }

  // Map agent result → Fl_DeploymentTarget.status enum per schema doc.
  let nextStatus: string
  switch (env.result) {
    case "installed":
    case "updated":
      nextStatus = "succeeded"
      break
    case "no-op":
      nextStatus = "no-op"
      break
    case "reboot-required":
      // Server treats as success — orchestrator decides whether to reboot or
      // mark reboot-deferred per Fl_Deployment.rebootPolicy.
      nextStatus = "succeeded"
      break
    case "reboot-deferred":
      nextStatus = "reboot-deferred"
      break
    case "failed":
    default:
      nextStatus = "failed"
      break
  }

  const completedAt = new Date()
  await prisma.fl_DeploymentTarget.update({
    where: { id: env.commandId },
    data: {
      status: nextStatus,
      exitCode: env.exitCode,
      durationMs: env.durationMs,
      detectedVersionPost: env.detectedVersion ?? null,
      stderrTail: env.stderrTail ?? null,
      outputUrl: env.outputUrl ?? null,
      completedAt,
      ...(target.startedAt
        ? {}
        : { startedAt: new Date(completedAt.getTime() - env.durationMs) }),
    },
  })

  const device = await prisma.fl_Device.findUnique({
    where: { id: target.deviceId },
    select: { clientName: true },
  })
  await writeAudit({
    deviceId: target.deviceId,
    clientName: device?.clientName ?? null,
    action: "software.deployment.target-complete",
    outcome: nextStatus === "succeeded" || nextStatus === "no-op" ? "ok" : "error",
    detail: {
      targetId: env.commandId,
      deploymentId: target.deploymentId,
      result: env.result,
      exitCode: env.exitCode,
      durationMs: env.durationMs,
      detectedVersion: env.detectedVersion ?? null,
      rebootPending: env.rebootPending ?? false,
    },
  })

  await onTargetCompleted(target.deploymentId, env.commandId)

  return {
    method: "software.complete",
    deviceId: target.deviceId,
    commandId: env.commandId,
    state: nextStatus,
  }
}

// ─── patches.* handlers (Phase 4) ─────────────────────────────────────────
//
// commandId on progress/complete = Fl_PatchInstall.id created at dispatch
// time by lib/patch-deploy.ts. patches.report is keyed by the scan's
// transient commandId — not stored as a row, just used to associate the
// scan results with the host that produced them.

const PATCH_STDERR_TAIL_BYTES = 4 * 1024

async function handlePatchesProgress(env: z.infer<typeof patchesProgress>): Promise<IngestResult> {
  const install = await prisma.fl_PatchInstall.findUnique({
    where: { id: env.commandId },
    select: { id: true, deviceId: true, state: true, rawDetail: true },
  })
  if (!install) {
    throw new Error(`patches.progress: unknown commandId ${env.commandId}`)
  }

  // State transition is racy with handlePatchesComplete (gateway fans out
  // notifications to FleetHub concurrently per WS message). Use a
  // conditional updateMany so progress NEVER overwrites a terminal state
  // set by complete that lost the wall-clock race but won the agent-side
  // emit-order. The where filter is the check-and-set guarantee.
  await prisma.fl_PatchInstall.updateMany({
    where: { id: env.commandId, state: { in: ["queued", "missing", "available"] } },
    data: { state: "installing" },
  })

  // Stash the most recent message in rawDetail for the deploy monitor's
  // inline status. stderr chunks accumulate (capped) into rawDetail too.
  const rawUpdate: Record<string, unknown> = {}
  if (env.message) rawUpdate.rawDetail = env.message
  if (env.stream === "stderr" && env.data) {
    const existing = install.rawDetail ?? ""
    const merged = existing + env.data
    rawUpdate.rawDetail =
      merged.length > PATCH_STDERR_TAIL_BYTES
        ? merged.slice(merged.length - PATCH_STDERR_TAIL_BYTES)
        : merged
  }
  if (Object.keys(rawUpdate).length > 0) {
    await prisma.fl_PatchInstall.update({ where: { id: env.commandId }, data: rawUpdate })
  }
  return { method: "patches.progress", deviceId: install.deviceId, commandId: env.commandId }
}

async function handlePatchesComplete(env: z.infer<typeof patchesComplete>): Promise<IngestResult> {
  const install = await prisma.fl_PatchInstall.findUnique({
    where: { id: env.commandId },
    select: { id: true, deviceId: true, patchId: true, installingDeploymentId: true },
  })
  if (!install) {
    throw new Error(`patches.complete: unknown commandId ${env.commandId}`)
  }

  // Map agent result → Fl_PatchInstall.state per the schema's documented enum.
  let nextState: string
  switch (env.result) {
    case "installed":
      nextState = "installed"
      break
    case "no-op":
      nextState = "installed"
      break
    case "preflight-failed":
      nextState = "preflight-failed"
      break
    case "rolled-back":
      nextState = "missing" // rollback puts it back to missing
      break
    case "rollback-failed":
      nextState = "rollback-failed"
      break
    case "rollback-partial":
      nextState = "rollback-failed" // best-effort: dashboard treats partial as failed
      break
    case "detection-disagreement":
      nextState = "detection-disagreement"
      break
    case "reboot-required":
      // Honest "I installed but a reboot is needed". The deploy orchestrator
      // decides whether to reboot now (rebootPolicy=force) or surface the
      // pendingReboot flag.
      nextState = "installed"
      break
    case "reboot-deferred":
      nextState = "installed"
      break
    case "failed":
    default:
      nextState = "failed"
      break
  }

  await prisma.fl_PatchInstall.update({
    where: { id: env.commandId },
    data: {
      state: nextState,
      lastDetectedAt: new Date(),
      installedAt: nextState === "installed" ? new Date() : null,
      failureReason:
        env.preflightGateFailed
          ? `preflight-gate:${env.preflightGateFailed}`
          : env.detectionConsensus === "disagreement"
            ? "detection-disagreement"
            : nextState === "failed"
              ? env.stderrTail ?? `exit ${env.exitCode}`
              : null,
      wmiQfe: env.perMethodDetection?.["wmi-qfe"] ?? env.perMethodDetection?.wmiQfe ?? null,
      dismPackages: env.perMethodDetection?.["dism-packages"] ?? env.perMethodDetection?.dismPackages ?? null,
      wuHistory: env.perMethodDetection?.["wu-history"] ?? env.perMethodDetection?.wuHistory ?? null,
      rawDetail: env.stderrTail ?? null,
    },
  })

  // Bubble pendingReboot onto the device when the agent reported one.
  if (env.rebootPending) {
    await prisma.fl_Device.update({
      where: { id: install.deviceId },
      data: { pendingReboot: true, pendingRebootSince: new Date() },
    })
  }

  const device = await prisma.fl_Device.findUnique({
    where: { id: install.deviceId },
    select: { clientName: true },
  })
  await writeAudit({
    deviceId: install.deviceId,
    clientName: device?.clientName ?? null,
    action: nextState === "missing" ? "patch.uninstall.success" : "patch.deployment.target-complete",
    outcome: nextState === "installed" || nextState === "missing" ? "ok" : "error",
    detail: {
      installId: env.commandId,
      patchId: install.patchId,
      deploymentId: install.installingDeploymentId,
      result: env.result,
      exitCode: env.exitCode,
      durationMs: env.durationMs,
      detectionConsensus: env.detectionConsensus ?? null,
      perMethodDetection: env.perMethodDetection ?? null,
      rollbackStrategyUsed: env.rollbackStrategyUsed ?? null,
      preflightGateFailed: env.preflightGateFailed ?? null,
    },
  })

  return {
    method: "patches.complete",
    deviceId: install.deviceId,
    commandId: env.commandId,
    state: nextState,
  }
}

// patches.advisory.fire — agent's local Windows Update API saw a KB the
// catalog hasn't ingested yet. Stored as Fl_Alert(kind=patch.advisory) so
// /alerts surfaces it; the next CVE/catalog ingest cron will resolve it
// into a real Fl_Patch row.
async function handlePatchesAdvisoryFire(env: z.infer<typeof patchesAdvisoryFire>): Promise<IngestResult> {
  const device = await prisma.fl_Device.findFirst({
    where: { agentId: env.agentId },
    select: { id: true, clientName: true },
  })
  if (!device) {
    throw new Error(`patches.advisory.fire: unknown agentId ${env.agentId}`)
  }

  const alert = await prisma.fl_Alert.create({
    data: {
      clientName: device.clientName,
      deviceId: device.id,
      kind: "patch.advisory",
      severity: env.classification === "critical" ? "critical" : "warn",
      title: `Advisory: ${env.kbId}`,
      detailJson: JSON.stringify({
        kbId: env.kbId,
        publishedAt: env.publishedAt ?? null,
        classification: env.classification ?? "unknown",
      }),
      state: "open",
    },
    select: { id: true },
  })
  await writeAudit({
    deviceId: device.id,
    clientName: device.clientName,
    action: "patch.advisory.ingest",
    outcome: "pending",
    detail: { kbId: env.kbId, classification: env.classification, alertId: alert.id },
  })
  return { method: "patches.advisory.fire", deviceId: device.id, alertId: alert.id }
}

// patches.report — full scan output. Each entry becomes (or updates) a
// Fl_PatchInstall row with state="missing" tagged for this device. The
// catalog row (Fl_Patch) is upserted by sourceId so multiple agents
// reporting the same KB don't create duplicates.
async function handlePatchesReport(env: z.infer<typeof patchesReport>): Promise<IngestResult> {
  const device = await prisma.fl_Device.findFirst({
    where: { agentId: env.agentId },
    select: { id: true },
  })
  if (!device) {
    throw new Error(`patches.report: unknown agentId ${env.agentId}`)
  }
  if (env.error) {
    return { method: "patches.report", deviceId: device.id, commandId: env.commandId, state: "error" }
  }

  for (const entry of env.patches ?? []) {
    // Upsert the catalog row.
    const patch = await prisma.fl_Patch.upsert({
      where: { source_sourceId: { source: entry.source, sourceId: entry.sourceId } },
      create: {
        source: entry.source,
        sourceId: entry.sourceId,
        os: entry.source === "ms" ? "windows" : "linux",
        title: entry.title ?? entry.sourceId,
        classification: entry.classification ?? "security",
      },
      update: {
        title: entry.title ?? undefined,
        classification: entry.classification ?? undefined,
      },
    })
    // Upsert the install row (missing = available but not yet installed).
    await prisma.fl_PatchInstall.upsert({
      where: { deviceId_patchId: { deviceId: device.id, patchId: patch.id } },
      create: {
        deviceId: device.id,
        patchId: patch.id,
        state: "missing",
        lastDetectedAt: new Date(),
      },
      update: {
        state: "missing",
        lastDetectedAt: new Date(),
      },
    })
  }

  return {
    method: "patches.report",
    deviceId: device.id,
    commandId: env.commandId,
    state: "scanned",
  }
}




