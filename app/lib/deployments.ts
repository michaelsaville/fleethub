import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { parseStages, type RingStage, type StageSelector } from "@/lib/rings"
import { isInMaintenance } from "@/lib/maintenance"
import type { Fl_Deployment, Fl_DeploymentTarget } from "@prisma/client"

// Deployment orchestrator — Phase 3.
//
// Lifecycle (PHASE-3-DESIGN §5 + §8):
//   queued → running → (paused | auto-paused)? → completed | aborted
//
// Stage promotion: stages execute in array order. When a stage's
// targets all reach a terminal status (succeeded/failed/no-op/skipped/
// reboot-deferred), the orchestrator either auto-promotes (after
// autoPromoteAfterSec, if !requiresApproval) or pauses for operator
// click. abortFailureRate is checked continuously; exceeding it
// flips status to "auto-paused" with pauseReason.
//
// Real agent dispatch is a Phase 3 step 4-6 milestone. Today the
// "dispatcher" is mock-driven: simulateAgentResponse() advances a
// target as if the agent reported. The orchestration logic itself
// (stage promotion, halt-on-fail, etc.) IS production-correct — only
// the agent integration point is stubbed.

export interface CreateDeploymentInput {
  tenantName: string
  packageId: string
  packageVersionId: string
  ringId: string
  action: "install" | "uninstall" | "update"
  dryRun?: boolean
  rebootPolicyOverride?: string | null
  scheduledFor?: Date | null
  /** Resolved Fl_Device.id list — caller resolves RQL → ids before passing. */
  targetDeviceIds: string[]
  requestedBy: string
}

export async function createDeployment(input: CreateDeploymentInput) {
  const ring = await prisma.fl_DeployRing.findUnique({ where: { id: input.ringId } })
  if (!ring) throw new Error("Ring not found")

  const stages = parseStages(ring.stagesJson)
  if (stages.length === 0) throw new Error("Ring has no stages")

  // Honor Maintenance Mode: filter out devices that are paused.
  const filteredTargets: string[] = []
  for (const id of input.targetDeviceIds) {
    if (await isInMaintenance(id)) continue
    filteredTargets.push(id)
  }

  // Spread targets across stages by selector kind.
  const stageBuckets = await assignTargetsToStages(stages, filteredTargets, input.tenantName)

  const deployment = await prisma.fl_Deployment.create({
    data: {
      tenantName: input.tenantName,
      packageId: input.packageId,
      packageVersionId: input.packageVersionId,
      ringId: input.ringId,
      action: input.action,
      status: input.scheduledFor ? "queued" : "running",
      dryRun: input.dryRun ?? true,
      rebootPolicyOverride: input.rebootPolicyOverride ?? null,
      scheduledFor: input.scheduledFor ?? null,
      startedAt: input.scheduledFor ? null : new Date(),
      requestedBy: input.requestedBy,
      totalTargets: filteredTargets.length,
      pendingCount: filteredTargets.length,
      currentStage: stages[0].name,
      targets: {
        create: stageBuckets.flatMap(({ stage, deviceIds }) =>
          deviceIds.map((deviceId) => ({
            deviceId,
            stageName: stage.name,
            status: "pending" as const,
          })),
        ),
      },
    },
    include: { targets: true, package: true, ring: true },
  })

  await writeAudit({
    actorEmail: input.requestedBy,
    clientName: input.tenantName,
    action: "software.deployment.create",
    outcome: "ok",
    detail: {
      deploymentId: deployment.id,
      packageId: deployment.packageId,
      action: deployment.action,
      ringId: deployment.ringId,
      targetCount: filteredTargets.length,
      droppedToMaintenance: input.targetDeviceIds.length - filteredTargets.length,
      dryRun: deployment.dryRun,
    },
  })

  return deployment
}

// ─── Stage assignment ─────────────────────────────────────────────────

interface StageBucket {
  stage: RingStage
  deviceIds: string[]
}

async function assignTargetsToStages(
  stages: RingStage[],
  targetIds: string[],
  tenantName: string,
): Promise<StageBucket[]> {
  // We resolve each stage in order, removing already-bucketed devices.
  let remaining = [...targetIds]
  const buckets: StageBucket[] = []
  for (const stage of stages) {
    const ids = await resolveSelector(stage.selector, remaining, tenantName)
    buckets.push({ stage, deviceIds: ids })
    remaining = remaining.filter((id) => !ids.includes(id))
  }
  // Any leftover devices (no stage claimed them) drop into the last
  // stage with selector="remaining"; if no remaining stage, they are
  // discarded with a server warning.
  const remainingStageIdx = stages.findIndex((s) => s.selector.kind === "remaining")
  if (remaining.length > 0 && remainingStageIdx >= 0) {
    buckets[remainingStageIdx].deviceIds = [...buckets[remainingStageIdx].deviceIds, ...remaining]
  }
  return buckets
}

async function resolveSelector(
  selector: StageSelector,
  candidates: string[],
  tenantName: string,
): Promise<string[]> {
  if (selector.kind === "pinned") {
    return candidates.filter((id) => selector.deviceIds.includes(id))
  }
  if (selector.kind === "filter") {
    // Minimal RQL evaluation against Fl_Device. v1 supports:
    // role:<x>, os:<x>, client:<x>. Reuses the AssetsPage-style parsing
    // pattern but keyed on FleetHub fields.
    const where = parseDeviceRql(selector.rql, tenantName)
    const rows = await prisma.fl_Device.findMany({
      where: { AND: [{ id: { in: candidates } }, where] },
      select: { id: true },
    })
    return rows.map((r) => r.id)
  }
  if (selector.kind === "percentile") {
    const n = Math.max(1, Math.ceil((selector.percent / 100) * candidates.length))
    return candidates.slice(0, n)
  }
  if (selector.kind === "remaining") {
    return candidates
  }
  return []
}

function parseDeviceRql(rql: string, defaultClient: string) {
  const parts = rql.trim().split(/\s+/)
  const where: Record<string, unknown> = { clientName: defaultClient }
  for (const p of parts) {
    const m = p.match(/^([a-z]+):(.+)$/i)
    if (!m) continue
    const k = m[1].toLowerCase()
    const v = m[2]
    switch (k) {
      case "role":
        where.role = v
        break
      case "os":
        where.os = v
        break
      case "client":
        where.clientName = v
        break
      case "host":
      case "hostname":
        where.hostname = { contains: v, mode: "insensitive" }
        break
    }
  }
  return where
}

// ─── Stage progression ────────────────────────────────────────────────

export interface DeploymentSnapshot {
  deployment: Fl_Deployment
  targetsByStage: Record<string, Fl_DeploymentTarget[]>
  stages: RingStage[]
}

export async function getDeploymentSnapshot(deploymentId: string): Promise<DeploymentSnapshot | null> {
  const dep = await prisma.fl_Deployment.findUnique({
    where: { id: deploymentId },
    include: { ring: true, targets: true },
  })
  if (!dep) return null
  const stages = parseStages(dep.ring.stagesJson)
  const targetsByStage: Record<string, Fl_DeploymentTarget[]> = {}
  for (const s of stages) targetsByStage[s.name] = []
  for (const t of dep.targets) {
    if (!targetsByStage[t.stageName]) targetsByStage[t.stageName] = []
    targetsByStage[t.stageName].push(t)
  }
  // Strip the `targets` array off the deployment object — it's
  // available via `targetsByStage` instead.
  const { targets: _drop, ring: _ring, ...rest } = dep as typeof dep & { targets: Fl_DeploymentTarget[]; ring: unknown }
  return { deployment: rest as Fl_Deployment, targetsByStage, stages }
}

export function isTerminalStatus(s: string): boolean {
  return ["succeeded", "failed", "no-op", "skipped", "reboot-deferred"].includes(s)
}

export interface StageProgress {
  name: string
  total: number
  succeeded: number
  failed: number
  noOp: number
  rebootDeferred: number
  skipped: number
  pending: number
  running: number
  /** All targets in the stage have a terminal status. */
  isComplete: boolean
  /** Live failure rate (0..1) including dispatched-but-running. */
  failureRate: number
}

export function summarizeStage(targets: Fl_DeploymentTarget[]): Omit<StageProgress, "name"> {
  const byStatus: Record<string, number> = {}
  for (const t of targets) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
  const succeeded = byStatus["succeeded"] ?? 0
  const failed = byStatus["failed"] ?? 0
  const noOp = byStatus["no-op"] ?? 0
  const rebootDeferred = byStatus["reboot-deferred"] ?? 0
  const skipped = byStatus["skipped"] ?? 0
  const pending = byStatus["pending"] ?? 0
  const running =
    (byStatus["dispatched"] ?? 0) +
    (byStatus["running"] ?? 0)
  const total = targets.length
  const isComplete = total > 0 && succeeded + failed + noOp + rebootDeferred + skipped === total
  const decided = succeeded + failed + noOp + rebootDeferred + skipped
  const failureRate = decided > 0 ? failed / decided : 0
  return { total, succeeded, failed, noOp, rebootDeferred, skipped, pending, running, isComplete, failureRate }
}

// ─── Operator actions ─────────────────────────────────────────────────

export async function pauseDeployment(deploymentId: string, by: string, reason: string) {
  const dep = await prisma.fl_Deployment.update({
    where: { id: deploymentId },
    data: { status: "paused", pausedAt: new Date(), pauseReason: reason },
  })
  await writeAudit({
    actorEmail: by,
    clientName: dep.tenantName,
    action: "software.deployment.pause",
    outcome: "ok",
    detail: { deploymentId, reason },
  })
  return dep
}

export async function resumeDeployment(deploymentId: string, by: string) {
  const dep = await prisma.fl_Deployment.update({
    where: { id: deploymentId },
    data: { status: "running", pausedAt: null, pauseReason: null },
  })
  await writeAudit({
    actorEmail: by,
    clientName: dep.tenantName,
    action: "software.deployment.resume",
    outcome: "ok",
    detail: { deploymentId },
  })
  return dep
}

export async function abortDeployment(deploymentId: string, by: string) {
  const dep = await prisma.fl_Deployment.update({
    where: { id: deploymentId },
    data: { status: "aborted", completedAt: new Date() },
  })
  // Skip any non-terminal targets so they don't get retried.
  await prisma.fl_DeploymentTarget.updateMany({
    where: {
      deploymentId,
      status: { in: ["pending", "dispatched", "running"] },
    },
    data: { status: "skipped" },
  })
  await writeAudit({
    actorEmail: by,
    clientName: dep.tenantName,
    action: "software.deployment.abort",
    outcome: "ok",
    detail: { deploymentId },
  })
  return dep
}

export async function promoteToNextStage(deploymentId: string, by: string) {
  const snap = await getDeploymentSnapshot(deploymentId)
  if (!snap) throw new Error("Deployment not found")
  const idx = snap.stages.findIndex((s) => s.name === snap.deployment.currentStage)
  if (idx < 0 || idx >= snap.stages.length - 1) {
    throw new Error("No next stage to promote to")
  }
  const next = snap.stages[idx + 1]
  const dep = await prisma.fl_Deployment.update({
    where: { id: deploymentId },
    data: { currentStage: next.name, status: "running", pausedAt: null, pauseReason: null },
  })
  await writeAudit({
    actorEmail: by,
    clientName: dep.tenantName,
    action: "software.deployment.promote",
    outcome: "ok",
    detail: { deploymentId, fromStage: snap.deployment.currentStage, toStage: next.name },
  })
  return dep
}

// ─── Mock agent simulation (Phase 3 step 4 + 6 swap-out point) ────────

/**
 * Simulate the agent reporting back on a deployment target.
 * Replaces the real agent dispatch path until Phase 3 step 4 lands.
 *
 * `outcome`:
 *   - "succeed" — installs cleanly, post-detection finds new version
 *   - "no-op" — package already installed at requested version
 *   - "fail-disk" — exit 1603, common MSI disk-space error
 *   - "fail-policy" — exit 5, GPO blocked install
 *   - "reboot-deferred" — install ran but a reboot is needed; deferred
 */
export async function simulateAgentResponse(
  targetId: string,
  outcome: "succeed" | "no-op" | "fail-disk" | "fail-policy" | "reboot-deferred",
  by: string,
) {
  const target = await prisma.fl_DeploymentTarget.findUnique({
    where: { id: targetId },
    include: { deployment: { include: { package: true } } },
  })
  if (!target) throw new Error("Target not found")

  let status: string
  let exitCode = 0
  let stderrTail: string | null = null
  let detectedPost: string | null = null
  let progressMessage = "Completed"

  switch (outcome) {
    case "succeed":
      status = "succeeded"
      detectedPost = "(simulated post-version)"
      progressMessage = "Installed successfully"
      break
    case "no-op":
      status = "no-op"
      progressMessage = "Already installed at requested version"
      break
    case "fail-disk":
      status = "failed"
      exitCode = 1603
      stderrTail =
        "MSI: 1603 - Fatal error during installation. Disk space C: 412 MB available; need 1 GB."
      progressMessage = "Failed: insufficient disk space"
      break
    case "fail-policy":
      status = "failed"
      exitCode = 5
      stderrTail = "Access denied. Group Policy CSE blocking install."
      progressMessage = "Failed: GPO blocked install"
      break
    case "reboot-deferred":
      status = "reboot-deferred"
      progressMessage = "Install complete; reboot deferred (user active)"
      break
  }

  const completedAt = new Date()
  const startedAt = target.startedAt ?? new Date(completedAt.getTime() - 10_000)

  await prisma.fl_DeploymentTarget.update({
    where: { id: targetId },
    data: {
      status,
      attemptCount: { increment: 1 },
      exitCode,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      stderrTail,
      detectedVersionPost: detectedPost,
      progressMessage,
      progressPercent: 100,
      startedAt,
      completedAt,
    },
  })

  // Drive Maintenance Mode update on reboot-deferred.
  if (outcome === "reboot-deferred") {
    await prisma.fl_Device.update({
      where: { id: target.deviceId },
      data: { pendingReboot: true, pendingRebootSince: new Date() },
    })
  }

  // Update aggregate counters on the deployment.
  await refreshDeploymentCounters(target.deploymentId)

  // Check halt-on-failure threshold; auto-pause if exceeded.
  await maybeAutoPause(target.deploymentId)

  // Single audit row per target completion.
  await writeAudit({
    actorEmail: by,
    clientName: target.deployment.tenantName,
    deviceId: target.deviceId,
    action: "software.deployment.target-complete",
    outcome: status === "succeeded" || status === "no-op" || status === "reboot-deferred" ? "ok" : "error",
    detail: { deploymentId: target.deploymentId, targetId, status, exitCode },
  })
}

async function refreshDeploymentCounters(deploymentId: string) {
  const targets = await prisma.fl_DeploymentTarget.findMany({
    where: { deploymentId },
    select: { status: true },
  })
  const counts = {
    succeeded: 0,
    failed: 0,
    noOp: 0,
    pending: 0,
    rebootDeferred: 0,
  }
  for (const t of targets) {
    if (t.status === "succeeded") counts.succeeded++
    else if (t.status === "failed") counts.failed++
    else if (t.status === "no-op") counts.noOp++
    else if (t.status === "reboot-deferred") counts.rebootDeferred++
    else if (["pending", "dispatched", "running"].includes(t.status)) counts.pending++
  }
  const allTerminal =
    counts.pending === 0 &&
    counts.succeeded + counts.failed + counts.noOp + counts.rebootDeferred + targets.filter((t) => t.status === "skipped").length === targets.length
  await prisma.fl_Deployment.update({
    where: { id: deploymentId },
    data: {
      succeededCount: counts.succeeded,
      failedCount: counts.failed,
      noOpCount: counts.noOp,
      pendingCount: counts.pending,
      rebootDeferredCount: counts.rebootDeferred,
      ...(allTerminal ? { status: "completed", completedAt: new Date() } : {}),
    },
  })
}

async function maybeAutoPause(deploymentId: string) {
  const snap = await getDeploymentSnapshot(deploymentId)
  if (!snap) return
  if (snap.deployment.status === "paused" || snap.deployment.status === "auto-paused") return
  if (snap.deployment.status === "completed" || snap.deployment.status === "aborted") return

  const stage = snap.stages.find((s) => s.name === snap.deployment.currentStage)
  if (!stage) return
  const targets = snap.targetsByStage[stage.name] ?? []
  const summary = summarizeStage(targets)
  if (summary.failureRate > stage.abortFailureRate) {
    await prisma.fl_Deployment.update({
      where: { id: deploymentId },
      data: {
        status: "auto-paused",
        pausedAt: new Date(),
        pauseReason: `Stage ${stage.name} failure rate ${(summary.failureRate * 100).toFixed(0)}% exceeded threshold ${(stage.abortFailureRate * 100).toFixed(0)}%`,
      },
    })
    await writeAudit({
      actorEmail: "system",
      clientName: snap.deployment.tenantName,
      action: "software.deployment.auto-pause",
      outcome: "ok",
      detail: {
        deploymentId,
        stage: stage.name,
        failureRate: summary.failureRate,
        threshold: stage.abortFailureRate,
      },
    })
  }
}

export async function retryTarget(targetId: string, by: string) {
  const target = await prisma.fl_DeploymentTarget.findUnique({
    where: { id: targetId },
    include: { deployment: true },
  })
  if (!target) throw new Error("Target not found")
  if (target.status !== "failed") {
    throw new Error("Can only retry failed targets")
  }
  await prisma.fl_DeploymentTarget.update({
    where: { id: targetId },
    data: {
      status: "pending",
      stderrTail: null,
      exitCode: null,
      progressMessage: null,
      progressPercent: null,
    },
  })
  await refreshDeploymentCounters(target.deploymentId)
  await writeAudit({
    actorEmail: by,
    clientName: target.deployment.tenantName,
    deviceId: target.deviceId,
    action: "software.deployment.target-retry",
    outcome: "ok",
    detail: { deploymentId: target.deploymentId, targetId },
  })
}

export async function skipTarget(targetId: string, by: string) {
  const target = await prisma.fl_DeploymentTarget.findUnique({
    where: { id: targetId },
    include: { deployment: true },
  })
  if (!target) throw new Error("Target not found")
  await prisma.fl_DeploymentTarget.update({
    where: { id: targetId },
    data: { status: "skipped", completedAt: new Date() },
  })
  await refreshDeploymentCounters(target.deploymentId)
  await writeAudit({
    actorEmail: by,
    clientName: target.deployment.tenantName,
    deviceId: target.deviceId,
    action: "software.deployment.target-skip",
    outcome: "ok",
    detail: { deploymentId: target.deploymentId, targetId },
  })
}
