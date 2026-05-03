import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { isInMaintenance } from "@/lib/maintenance"
import { dispatchToAgent } from "@/lib/agent-dispatch"

// Phase 2 dispatcher. Creates Fl_ScriptRun rows in queued state and
// (in mock-mode) lets the operator simulate agent responses for
// click-through testing. Real agent dispatch lands in Phase 2 step 4.

export interface RunScriptInput {
  scriptId: string
  deviceId: string
  initiatedBy: string
  dryRun?: boolean
  args?: string[]
  env?: Record<string, string>
  timeoutSec?: number
}

export async function runScript(input: RunScriptInput) {
  const [script, device] = await Promise.all([
    prisma.fl_Script.findUnique({ where: { id: input.scriptId } }),
    prisma.fl_Device.findUnique({ where: { id: input.deviceId } }),
  ])
  if (!script) throw new Error("Script not found")
  if (!device) throw new Error("Device not found")

  // Maintenance Mode honored at dispatch time.
  if (await isInMaintenance(input.deviceId)) {
    const rejected = await prisma.fl_ScriptRun.create({
      data: {
        scriptId: input.scriptId,
        deviceId: input.deviceId,
        initiatedBy: input.initiatedBy,
        state: "rejected",
        rejectReason: "device-maintenance-mode",
        dryRun: input.dryRun ?? true,
      },
    })
    await writeAudit({
      actorEmail: input.initiatedBy,
      clientName: device.clientName,
      deviceId: device.id,
      action: "scripts.dispatch.rejected",
      outcome: "error",
      detail: { runId: rejected.id, reason: "device-maintenance-mode", scriptId: script.id },
    })
    return rejected
  }

  // Force dry-run when the script can't honor it.
  const dryRun = script.dryRunCapable ? (input.dryRun ?? true) : true

  const run = await prisma.fl_ScriptRun.create({
    data: {
      scriptId: input.scriptId,
      deviceId: input.deviceId,
      initiatedBy: input.initiatedBy,
      state: "queued",
      dryRun,
      argsJson: input.args ? JSON.stringify(input.args) : null,
      envJson: input.env ? JSON.stringify(input.env) : null,
      timeoutSec: input.timeoutSec ?? 300,
    },
  })

  await writeAudit({
    actorEmail: input.initiatedBy,
    clientName: device.clientName,
    deviceId: device.id,
    action: "scripts.dispatch",
    outcome: "ok",
    detail: {
      runId: run.id,
      scriptId: script.id,
      scriptSha256: script.bodySha256,
      dryRun,
      capabilities: script.capabilitiesJson ?? null,
    },
  })

  // Real dispatch via the WSS gateway. If the gateway URL isn't set
  // (dev without a gateway running) the run stays in `queued` and the
  // admin _simulate endpoint can still drive it. If the agent isn't
  // connected we mark the run rejected and audit the reason.
  if (process.env.PCC2K_GATEWAY_URL && device.agentId) {
    const result = await dispatchToAgent({
      agentId: device.agentId,
      method: "scripts.exec",
      id: run.id,
      params: {
        commandId: run.id,
        scriptId: script.id,
        scriptBody: script.body,
        scriptSig: script.bodyEd25519Sig ?? "",
        signerKid: "", // Phase 2.5 — when bodyEd25519SignerKid lands.
        scriptSha256: script.bodySha256 ?? "",
        interpreter: script.shell,
        args: input.args ?? [],
        env: input.env ?? {},
        dryRun,
        timeoutSec: input.timeoutSec ?? 300,
        outputBytesCap: 65536,
      },
    })
    if (!result.ok) {
      await prisma.fl_ScriptRun.update({
        where: { id: run.id },
        data: { state: "rejected", rejectReason: `dispatch:${result.error}` },
      })
      await writeAudit({
        actorEmail: input.initiatedBy,
        clientName: device.clientName,
        deviceId: device.id,
        action: "scripts.dispatch.rejected",
        outcome: "error",
        detail: { runId: run.id, status: result.status, error: result.error },
      })
    }
  }

  return run
}

export async function cancelScriptRun(runId: string, by: string) {
  const run = await prisma.fl_ScriptRun.findUnique({
    where: { id: runId },
  })
  if (!run) throw new Error("Run not found")
  if (["ok", "error", "cancelled", "timeout", "dryrun", "rejected"].includes(run.state)) {
    throw new Error("Run already finished")
  }
  const updated = await prisma.fl_ScriptRun.update({
    where: { id: runId },
    data: { state: "cancelled", finishedAt: new Date() },
  })
  const device = await prisma.fl_Device.findUnique({ where: { id: run.deviceId }, select: { clientName: true } })
  await writeAudit({
    actorEmail: by,
    clientName: device?.clientName ?? null,
    deviceId: run.deviceId,
    action: "scripts.cancel",
    outcome: "ok",
    detail: { runId, reason: "operator-cancel" },
  })
  return updated
}

/**
 * Mock-mode helper: simulate the agent reporting back. Replaces real
 * agent dispatch until Phase 2 step 4 lands.
 */
export async function simulateScriptResult(
  runId: string,
  outcome: "ok" | "error" | "timeout",
  output: string,
  exitCode: number,
  by: string,
) {
  const run = await prisma.fl_ScriptRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error("Run not found")
  const startedAt = run.startedAt ?? new Date(Date.now() - 8000)
  const finishedAt = new Date()
  const updated = await prisma.fl_ScriptRun.update({
    where: { id: runId },
    data: {
      state: outcome,
      output: outcome === "error" ? null : output,
      stderr: outcome === "error" ? output : null,
      exitCode,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      outputBytes: output.length,
    },
  })
  const device = await prisma.fl_Device.findUnique({ where: { id: run.deviceId }, select: { clientName: true } })
  await writeAudit({
    actorEmail: by,
    clientName: device?.clientName ?? null,
    deviceId: run.deviceId,
    action: "scripts.complete",
    outcome: outcome === "ok" ? "ok" : "error",
    detail: { runId, exitCode, durationMs: updated.durationMs ?? null },
  })
  return updated
}
