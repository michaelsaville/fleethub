import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// Update Rings — Action1's pattern. Reusable rollout shape with
// per-stage selectors + abort thresholds + auto-promote rules.
// See PHASE-3-DESIGN §5.

export type StageSelector =
  | { kind: "pinned"; deviceIds: string[] }
  | { kind: "filter"; rql: string }
  | { kind: "percentile"; percent: number; from?: string }
  | { kind: "remaining" }

export interface RingStage {
  name: string
  selector: StageSelector
  /** Live failure rate during the stage above which the deployment auto-pauses. */
  abortFailureRate: number
  /** Soak period before auto-advancing. 0 = no auto-promote (manual only). */
  autoPromoteAfterSec: number
  /** When true, auto-promote is gated by a human click. */
  requiresApproval: boolean
}

export interface CreateRingInput {
  tenantName: string
  name: string
  stages: RingStage[]
  isDefault?: boolean
  createdBy: string
}

export const STANDARD_4_STAGE: RingStage[] = [
  {
    name: "canary",
    selector: { kind: "pinned", deviceIds: [] },
    abortFailureRate: 0.34, // 1 of 3 fails → halt
    autoPromoteAfterSec: 7200, // 2 hour soak
    requiresApproval: true, // manual click between canary and wave-1
  },
  {
    name: "wave-1",
    selector: { kind: "percentile", percent: 25 },
    abortFailureRate: 0.2,
    autoPromoteAfterSec: 14400, // 4 hour soak
    requiresApproval: true,
  },
  {
    name: "wave-2",
    selector: { kind: "percentile", percent: 60 },
    abortFailureRate: 0.15,
    autoPromoteAfterSec: 21600, // 6 hour soak
    requiresApproval: false, // auto-promote to full
  },
  { name: "full", selector: { kind: "remaining" }, abortFailureRate: 0.1, autoPromoteAfterSec: 0, requiresApproval: false },
]

export const HEALTHCARE_CONSERVATIVE: RingStage[] = [
  {
    name: "canary",
    selector: { kind: "pinned", deviceIds: [] },
    abortFailureRate: 0.0, // any failure halts
    autoPromoteAfterSec: 86_400, // 24 hour soak
    requiresApproval: true,
  },
  {
    name: "pilot",
    selector: { kind: "filter", rql: "role:lab" },
    abortFailureRate: 0.1,
    autoPromoteAfterSec: 86_400,
    requiresApproval: true,
  },
  {
    name: "production",
    selector: { kind: "remaining" },
    abortFailureRate: 0.05,
    autoPromoteAfterSec: 0,
    requiresApproval: true,
  },
]

export async function createRing(input: CreateRingInput) {
  const ring = await prisma.fl_DeployRing.create({
    data: {
      tenantName: input.tenantName,
      name: input.name.trim(),
      stagesJson: JSON.stringify(input.stages),
      isDefault: input.isDefault ?? false,
    },
  })
  if (input.isDefault) {
    // Single default per tenant.
    await prisma.fl_DeployRing.updateMany({
      where: { tenantName: input.tenantName, id: { not: ring.id }, isDefault: true },
      data: { isDefault: false },
    })
  }
  await writeAudit({
    actorEmail: input.createdBy,
    clientName: input.tenantName,
    action: "software.ring.create",
    outcome: "ok",
    detail: { ringId: ring.id, name: ring.name, stages: input.stages.length },
  })
  return ring
}

export async function updateRing(
  ringId: string,
  by: string,
  data: { name?: string; stages?: RingStage[]; isDefault?: boolean },
) {
  const ring = await prisma.fl_DeployRing.update({
    where: { id: ringId },
    data: {
      ...(data.name && { name: data.name.trim() }),
      ...(data.stages && { stagesJson: JSON.stringify(data.stages) }),
      ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
    },
  })
  if (data.isDefault) {
    await prisma.fl_DeployRing.updateMany({
      where: { tenantName: ring.tenantName, id: { not: ring.id }, isDefault: true },
      data: { isDefault: false },
    })
  }
  await writeAudit({
    actorEmail: by,
    clientName: ring.tenantName,
    action: "software.ring.update",
    outcome: "ok",
    detail: { ringId: ring.id, name: ring.name },
  })
  return ring
}

export function parseStages(stagesJson: string): RingStage[] {
  try {
    const parsed = JSON.parse(stagesJson)
    if (!Array.isArray(parsed)) return []
    return parsed as RingStage[]
  } catch {
    return []
  }
}

export async function ensureDefaultRing(tenantName: string, createdBy: string) {
  const existing = await prisma.fl_DeployRing.findFirst({
    where: { tenantName, isDefault: true, archivedAt: null },
  })
  if (existing) return existing
  return createRing({
    tenantName,
    name: "Standard 4-stage",
    stages: STANDARD_4_STAGE,
    isDefault: true,
    createdBy,
  })
}
