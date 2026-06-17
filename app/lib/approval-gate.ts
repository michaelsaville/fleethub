import "server-only"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// Phase 11 WS-B.1 — 4-eyes approval workflow primitive.
//
// State machine: pending → approved | denied | expired
//                approved → consumed (one-way, race-safe)
//
// payloadHash is captured at requireApproval() and verified at
// consumeApproval() — protects against payload-swap-after-approval.
// Without that check, an attacker could swap params between approve
// and dispatch.

export type ApprovalAction =
  | "bulk.dispatch"
  | "shell.open"
  | "device.power" // WS-C — reboot/shutdown/logoff
  | "credential.disclose"
  | "credential.update"
  | "alert-route.delete"
  | "oncall-schedule.delete"

const DEFAULT_TTL_MS = 24 * 60 * 60_000

/** Canonical JSON for hashing — sort keys, no whitespace. */
function canonicalize(payload: unknown): string {
  return JSON.stringify(sortKeys(payload))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const keys = Object.keys(v as Record<string, unknown>).sort()
    const out: Record<string, unknown> = {}
    for (const k of keys) out[k] = sortKeys((v as Record<string, unknown>)[k])
    return out
  }
  return v
}

export function hashPayload(payload: unknown): { canonical: string; hex: string } {
  const canonical = canonicalize(payload)
  const hex = createHash("sha256").update(canonical).digest("hex")
  return { canonical, hex }
}

export type RequireApprovalInput = {
  action: ApprovalAction
  tenantName: string
  payload: unknown
  scope?: string
  requestedBy: string
  requiredRole?: "ADMIN" | "MANAGER"
  ttlMs?: number
}

export type RequireApprovalResult =
  | { status: "auto-approved"; approvalId: string; payloadHash: string }
  | { status: "pending"; approvalId: string; payloadHash: string; expiresAt: Date }

/** Create a Fl_ActionApproval. Per-tenant policy may auto-approve
 *  (e.g. single-operator dev tenants) — v1 does NOT auto-approve;
 *  every gated call goes to peer review. The status branch is here
 *  so we can wire policy in later without changing call sites. */
export async function requireApproval(
  input: RequireApprovalInput,
): Promise<RequireApprovalResult> {
  const { canonical, hex: payloadHash } = hashPayload(input.payload)
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS
  const expiresAt = new Date(Date.now() + ttl)
  const row = await prisma.fl_ActionApproval.create({
    data: {
      action: input.action,
      tenantName: input.tenantName,
      payloadJson: canonical,
      payloadHash,
      requestedBy: input.requestedBy,
      requiredRole: input.requiredRole ?? "ADMIN",
      state: "pending",
      expiresAt,
    },
  })
  await writeAudit({
    actorEmail: input.requestedBy,
    clientName: input.tenantName,
    action: "approval.requested",
    outcome: "pending",
    detail: {
      approvalId: row.id,
      gatedAction: input.action,
      scope: input.scope ?? null,
    },
  }).catch(() => {})
  return { status: "pending", approvalId: row.id, payloadHash, expiresAt }
}

export type ApproveInput = {
  approvalId: string
  approverEmail: string
}

export type ApprovalDecisionResult =
  | { ok: true }
  | { ok: false; reason: string; status: number }

/** Mark an approval as approved. Refuses self-approve (4-eyes
 *  invariant). Refuses any state other than pending. */
export async function approveAction(
  input: ApproveInput,
): Promise<ApprovalDecisionResult> {
  const row = await prisma.fl_ActionApproval.findUnique({
    where: { id: input.approvalId },
  })
  if (!row) return { ok: false, reason: "not found", status: 404 }
  if (row.state !== "pending") {
    return { ok: false, reason: `cannot approve from state '${row.state}'`, status: 409 }
  }
  if (row.expiresAt.getTime() < Date.now()) {
    // Lazy expire: flip to expired now so the list view sees it.
    await prisma.fl_ActionApproval.update({
      where: { id: row.id },
      data: { state: "expired" },
    })
    return { ok: false, reason: "expired", status: 410 }
  }
  if (row.requestedBy === input.approverEmail) {
    return { ok: false, reason: "self-approval not allowed (4-eyes)", status: 403 }
  }
  // Race-safe approve: only flip if still pending. updateMany returns
  // count; 0 means someone else got there first (or expired).
  const updated = await prisma.fl_ActionApproval.updateMany({
    where: { id: row.id, state: "pending" },
    data: {
      state: "approved",
      approverEmail: input.approverEmail,
      approvedAt: new Date(),
    },
  })
  if (updated.count === 0) {
    return { ok: false, reason: "race lost — state changed", status: 409 }
  }
  await writeAudit({
    actorEmail: input.approverEmail,
    clientName: row.tenantName,
    action: "approval.granted",
    outcome: "ok",
    detail: { approvalId: row.id, gatedAction: row.action },
  }).catch(() => {})
  return { ok: true }
}

export type DenyInput = {
  approvalId: string
  approverEmail: string
  reason: string
}

export async function denyAction(
  input: DenyInput,
): Promise<ApprovalDecisionResult> {
  const row = await prisma.fl_ActionApproval.findUnique({
    where: { id: input.approvalId },
  })
  if (!row) return { ok: false, reason: "not found", status: 404 }
  if (row.state !== "pending") {
    return { ok: false, reason: `cannot deny from state '${row.state}'`, status: 409 }
  }
  if (row.requestedBy === input.approverEmail) {
    return { ok: false, reason: "self-deny not allowed (4-eyes)", status: 403 }
  }
  const updated = await prisma.fl_ActionApproval.updateMany({
    where: { id: row.id, state: "pending" },
    data: {
      state: "denied",
      approverEmail: input.approverEmail,
      approvedAt: new Date(),
      denyReason: input.reason,
    },
  })
  if (updated.count === 0) {
    return { ok: false, reason: "race lost — state changed", status: 409 }
  }
  await writeAudit({
    actorEmail: input.approverEmail,
    clientName: row.tenantName,
    action: "approval.denied",
    outcome: "ok",
    detail: { approvalId: row.id, gatedAction: row.action, reason: input.reason },
  }).catch(() => {})
  return { ok: true }
}

export type ConsumeApprovalInput = {
  approvalId: string
  action: ApprovalAction
  payloadHash: string
}

export type ConsumeResult =
  | { ok: true; tenantName: string; requestedBy: string; approverEmail: string }
  | { ok: false; reason: string; status: number }

/** Race-safe consume: state='approved' → 'consumed' in one update.
 *  Verifies action matches AND payloadHash matches (anti-swap). */
export async function consumeApproval(
  input: ConsumeApprovalInput,
): Promise<ConsumeResult> {
  const row = await prisma.fl_ActionApproval.findUnique({
    where: { id: input.approvalId },
  })
  if (!row) return { ok: false, reason: "approval not found", status: 404 }
  if (row.state !== "approved") {
    return { ok: false, reason: `cannot consume from state '${row.state}'`, status: 409 }
  }
  if (row.action !== input.action) {
    return {
      ok: false,
      reason: `action mismatch — approval is for '${row.action}'`,
      status: 403,
    }
  }
  if (row.payloadHash !== input.payloadHash) {
    return {
      ok: false,
      reason: "payload hash mismatch — payload swapped after approval",
      status: 403,
    }
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.fl_ActionApproval.updateMany({
      where: { id: row.id, state: "approved" },
      data: { state: "expired" },
    })
    return { ok: false, reason: "approval expired before consume", status: 410 }
  }
  const updated = await prisma.fl_ActionApproval.updateMany({
    where: { id: row.id, state: "approved" },
    data: { state: "consumed", consumedAt: new Date() },
  })
  if (updated.count === 0) {
    return { ok: false, reason: "race lost — state changed", status: 409 }
  }
  await writeAudit({
    actorEmail: row.requestedBy,
    clientName: row.tenantName,
    action: "approval.consumed",
    outcome: "ok",
    detail: { approvalId: row.id, gatedAction: row.action },
  }).catch(() => {})
  return {
    ok: true,
    tenantName: row.tenantName,
    requestedBy: row.requestedBy,
    approverEmail: row.approverEmail ?? "",
  }
}

/** Decide whether a verb requires approval for a given tenant.
 *  Returns the required state, lets the caller branch. */
export async function shouldRequireApproval(
  action: ApprovalAction,
  tenantName: string,
  context: { deviceCount?: number; deviceTags?: string[]; alertRouteId?: string; powerAction?: string } = {},
): Promise<{ required: boolean; reason?: string }> {
  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: tenantName },
    select: {
      bulkApprovalThreshold: true,
      disclosureRequiresApproval: true,
      shellApprovalTagsJson: true,
    },
  })
  if (!tenant) return { required: false }
  switch (action) {
    case "bulk.dispatch":
      if ((context.deviceCount ?? 0) > tenant.bulkApprovalThreshold) {
        return { required: true, reason: `${context.deviceCount} devices > threshold ${tenant.bulkApprovalThreshold}` }
      }
      return { required: false }
    case "shell.open": {
      const tags = tenant.shellApprovalTagsJson
        ? (JSON.parse(tenant.shellApprovalTagsJson) as string[])
        : []
      if (tags.length === 0) return { required: false }
      const overlap = (context.deviceTags ?? []).some((t) => tags.includes(t))
      return overlap
        ? { required: true, reason: `device has approval-required tag(s): ${(context.deviceTags ?? []).filter((t) => tags.includes(t)).join(", ")}` }
        : { required: false }
    }
    case "credential.disclose":
    case "credential.update":
      return tenant.disclosureRequiresApproval
        ? { required: true, reason: "tenant policy: disclosureRequiresApproval" }
        : { required: false }
    case "alert-route.delete":
    case "oncall-schedule.delete":
      // Always gated — destructive on shared infra.
      return { required: true, reason: "destructive edit on shared infrastructure" }
    case "device.power":
      // WS-C — shutdown/logoff strand a remote box (no remote power-on),
      // so they need peer review. A reboot is routine (the host comes
      // back) — TECH + confirm is enough.
      if (context.powerAction === "shutdown" || context.powerAction === "logoff") {
        return { required: true, reason: `${context.powerAction} requires peer review (remote host won't power back on)` }
      }
      return { required: false }
  }
}
