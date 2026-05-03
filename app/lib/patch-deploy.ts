import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { dispatchToAgent } from "@/lib/agent-dispatch"

// Phase 4 step 6 — real patches.deploy dispatch.
//
// Per-host orchestration lives in Fl_PatchInstall directly (no separate
// patch-deployment table for v1). One install row per (deviceId, patchId)
// is upserted to state="queued" with a shared `installingDeploymentId`
// that groups the batch for audit. patches.deploy is then fired at each
// target's agent; the install.id is used as commandId so the existing
// handlePatchesProgress / handlePatchesComplete handlers in
// lib/agent-ingest.ts can drive the row through its terminal state.
//
// Ring staging + halt-on-failure are deferred — Phase 4.5+. For now we
// dispatch in parallel to every approved target. Operator who wants
// canary-style rollout selects a smaller deviceIds list and re-runs.

export interface PatchDeployInput {
  patchId: string
  deviceIds: string[]
  dryRun: boolean
  rebootPolicy?: string // override for this batch; null = use Fl_Patch default
  initiatedBy: string   // operator email for the audit chain
}

export interface PatchDeployResult {
  deploymentId: string
  dispatched: number
  failed: number
  skipped: number
  installs: Array<{ id: string; deviceId: string; status: string }>
}

export async function dispatchPatchDeploy(input: PatchDeployInput): Promise<PatchDeployResult> {
  const patch = await prisma.fl_Patch.findUnique({
    where: { id: input.patchId },
    select: {
      id: true,
      source: true,
      sourceId: true,
      isHotpatch: true,
      requiresReboot: true,
      artifactUrl: true,
      artifactSha256: true,
      bodyEd25519Sig: true,
      approvalState: true,
    },
  })
  if (!patch) throw new Error(`patch not found: ${input.patchId}`)
  if (patch.approvalState !== "approved") {
    throw new Error(`patch ${patch.sourceId} is ${patch.approvalState}; must be approved before deploy`)
  }

  // installingDeploymentId is a freeform cuid — used to group the install
  // rows that came from this single Deploy click for audit + monitor UI.
  const deploymentId = `pd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

  await writeAudit({
    actorEmail: input.initiatedBy,
    action: "patch.deployment.create",
    outcome: "ok",
    detail: {
      deploymentId,
      patchId: patch.id,
      sourceId: patch.sourceId,
      targetCount: input.deviceIds.length,
      dryRun: input.dryRun,
      rebootPolicy: input.rebootPolicy ?? null,
    },
  })

  const counts = { dispatched: 0, failed: 0, skipped: 0 }
  const installs: PatchDeployResult["installs"] = []

  // Skip dispatch entirely when the gateway isn't configured — leaves
  // the rows in queued state for the admin _simulate path (when one
  // exists for patches; today this is dispatch-or-bust).
  const gatewayConfigured = !!process.env.PCC2K_GATEWAY_URL

  for (const deviceId of input.deviceIds) {
    const device = await prisma.fl_Device.findUnique({
      where: { id: deviceId },
      select: { id: true, agentId: true, hostname: true, clientName: true },
    })
    if (!device?.agentId) {
      // Mark the install as failed-with-no-agent so /patches/[id] surfaces it.
      const install = await upsertInstall({
        deviceId,
        patchId: patch.id,
        deploymentId,
        state: "failed",
        rawDetail: "device has no agentId — agent never enrolled",
      })
      installs.push({ id: install.id, deviceId, status: "failed" })
      counts.failed++
      continue
    }

    const install = await upsertInstall({
      deviceId,
      patchId: patch.id,
      deploymentId,
      state: "queued",
      rawDetail: null,
    })

    if (!gatewayConfigured) {
      installs.push({ id: install.id, deviceId, status: "queued" })
      counts.skipped++
      continue
    }

    const result = await dispatchToAgent({
      agentId: device.agentId,
      method: "patches.deploy",
      id: install.id,
      params: {
        commandId: install.id,
        deploymentId,
        patch: {
          id: patch.id,
          source: patch.source,
          sourceId: patch.sourceId,
          isHotpatch: patch.isHotpatch ?? false,
          requiresReboot: patch.requiresReboot ?? false,
          artifactUrl: patch.artifactUrl ?? null,
          artifactSha256: patch.artifactSha256 ?? null,
          bodyEd25519Sig: patch.bodyEd25519Sig ?? null,
        },
        // v1 pre-flight gate: just the no-pending-reboot check + maintenance
        // mode. Disk-space + RAM + service-health gating is Phase 4.5.
        preflightGate: {
          requireNoPendingReboot: true,
          respectMaintenanceMode: true,
        },
        rebootPolicy: input.rebootPolicy ?? "defer-if-user-active",
        dryRun: input.dryRun,
        timeoutSec: 1800,
        outputBytesCap: 65536,
      },
    })

    if (result.ok) {
      // Move queued → installing once the agent has accepted dispatch.
      await prisma.fl_PatchInstall.update({
        where: { id: install.id },
        data: { state: "installing" },
      })
      installs.push({ id: install.id, deviceId, status: "installing" })
      counts.dispatched++
    } else {
      await prisma.fl_PatchInstall.update({
        where: { id: install.id },
        data: { state: "failed", rawDetail: `dispatch failed: ${result.error}` },
      })
      installs.push({ id: install.id, deviceId, status: "failed" })
      counts.failed++
    }
  }

  return { deploymentId, ...counts, installs }
}

// upsertInstall returns the Fl_PatchInstall row keyed by (deviceId, patchId).
// State + installingDeploymentId are always overwritten; rawDetail clears
// stale messages from prior attempts.
async function upsertInstall(args: {
  deviceId: string
  patchId: string
  deploymentId: string
  state: string
  rawDetail: string | null
}) {
  return prisma.fl_PatchInstall.upsert({
    where: { deviceId_patchId: { deviceId: args.deviceId, patchId: args.patchId } },
    create: {
      deviceId: args.deviceId,
      patchId: args.patchId,
      state: args.state,
      lastDetectedAt: new Date(),
      installingDeploymentId: args.deploymentId,
      rawDetail: args.rawDetail,
    },
    update: {
      state: args.state,
      installingDeploymentId: args.deploymentId,
      rawDetail: args.rawDetail,
      // Don't touch lastDetectedAt on dispatch — it represents the last
      // multi-signal scan, not the last operator action.
    },
  })
}

// dispatchPatchScanAll — fires patches.scan at every online device. Used
// by the /api/cron/patches-scan endpoint daily, or on-demand by an admin.
// Returns per-device dispatch result for visibility.
export async function dispatchPatchScanAll(): Promise<Array<{ agentId: string; hostname: string; ok: boolean; error?: string }>> {
  const devices = await prisma.fl_Device.findMany({
    where: { isOnline: true, agentId: { not: null } },
    select: { agentId: true, hostname: true },
  })
  const results: Array<{ agentId: string; hostname: string; ok: boolean; error?: string }> = []
  for (const d of devices) {
    if (!d.agentId) continue
    const cmdId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const r = await dispatchToAgent({
      agentId: d.agentId,
      method: "patches.scan",
      id: cmdId,
      params: { commandId: cmdId, detectionMethods: [], fullRescan: false },
    })
    results.push({
      agentId: d.agentId,
      hostname: d.hostname,
      ok: r.ok,
      error: r.ok ? undefined : r.error,
    })
  }
  return results
}
