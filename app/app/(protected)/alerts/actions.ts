"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { requireAdmin } from "@/lib/authz"
import { mockMode } from "@/lib/devices"

/**
 * Mutating server actions for the /alerts list. ADMIN-gated; the audit
 * row is written before the state change so a partial failure still
 * leaves a record. In mock mode the action throws — there are no real
 * `fl_alerts` rows to update, and silently no-op'ing would mislead the
 * operator that a seed alert was acked.
 */

function mockGuard(): never {
  throw new Error(
    "Alert mutations are unavailable in seed mode — no real fl_alerts rows exist. " +
    "Real alerts arrive once the agent ships and starts firing.",
  )
}

export async function ackAlert(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  if (await mockMode()) mockGuard()
  const id = formData.get("id")
  if (typeof id !== "string" || !id) throw new Error("Missing alert id")
  const alert = await prisma.fl_Alert.findUnique({ where: { id } })
  if (!alert) throw new Error("Alert not found")
  if (alert.state !== "open") return
  await writeAudit({
    actorEmail: ctx.email,
    clientName: alert.clientName,
    deviceId: alert.deviceId,
    action: "alert.ack",
    outcome: "ok",
    detail: { alertId: id, kind: alert.kind, severity: alert.severity },
  })
  await prisma.fl_Alert.update({
    where: { id },
    data: { state: "ack", ackedBy: ctx.email, ackedAt: new Date() },
  })
  revalidatePath("/alerts")
  revalidatePath(`/alerts/${id}`)
}

export async function resolveAlert(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  if (await mockMode()) mockGuard()
  const id = formData.get("id")
  if (typeof id !== "string" || !id) throw new Error("Missing alert id")
  const alert = await prisma.fl_Alert.findUnique({ where: { id } })
  if (!alert) throw new Error("Alert not found")
  if (alert.state === "resolved") return
  await writeAudit({
    actorEmail: ctx.email,
    clientName: alert.clientName,
    deviceId: alert.deviceId,
    action: "alert.resolve",
    outcome: "ok",
    detail: { alertId: id, kind: alert.kind, severity: alert.severity },
  })
  await prisma.fl_Alert.update({
    where: { id },
    data: {
      state: "resolved",
      resolvedAt: new Date(),
      ackedBy: alert.ackedBy ?? ctx.email,
      ackedAt: alert.ackedAt ?? new Date(),
    },
  })
  revalidatePath("/alerts")
  revalidatePath(`/alerts/${id}`)
}

export async function bulkAckAlerts(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  if (await mockMode()) mockGuard()
  const idsRaw = formData.get("ids")
  if (typeof idsRaw !== "string" || !idsRaw) throw new Error("Missing ids")
  const ids = idsRaw.split(",").filter(Boolean)
  if (ids.length === 0) return
  const alerts = await prisma.fl_Alert.findMany({
    where: { id: { in: ids }, state: "open" },
  })
  for (const alert of alerts) {
    await writeAudit({
      actorEmail: ctx.email,
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      action: "alert.ack",
      outcome: "ok",
      detail: { alertId: alert.id, kind: alert.kind, severity: alert.severity, bulk: true },
    })
    await prisma.fl_Alert.update({
      where: { id: alert.id },
      data: { state: "ack", ackedBy: ctx.email, ackedAt: new Date() },
    })
  }
  revalidatePath("/alerts")
}
