"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { requireAdmin } from "@/lib/authz"

// Phase 7 Workstream B step 3 — runbook server actions for inline
// state toggles on the detail page. The full create/edit form
// goes through /api/admin/runbooks; these actions handle the
// one-click ops (disable / enable).
//
// Untrip lands with step 4 (circuit breaker) since it pairs with
// the auto-trip logic.

async function toggleActive(id: string, target: boolean): Promise<void> {
  const ctx = await requireAdmin()
  if (typeof id !== "string" || !id) throw new Error("Missing runbook id")
  const runbook = await prisma.fl_Runbook.findUnique({ where: { id } })
  if (!runbook) throw new Error("Runbook not found")
  if (runbook.isActive === target) return
  await writeAudit({
    actorEmail: ctx.email,
    action: target ? "runbook.enabled" : "runbook.disabled",
    outcome: "ok",
    detail: { runbookId: id, runbookName: runbook.name },
  })
  await prisma.fl_Runbook.update({
    where: { id },
    data: { isActive: target },
  })
  revalidatePath("/runbooks")
  revalidatePath(`/runbooks/${id}`)
}

export async function disableRunbook(formData: FormData): Promise<void> {
  const id = formData.get("id")
  if (typeof id !== "string") throw new Error("Missing runbook id")
  await toggleActive(id, false)
}

export async function enableRunbook(formData: FormData): Promise<void> {
  const id = formData.get("id")
  if (typeof id !== "string") throw new Error("Missing runbook id")
  await toggleActive(id, true)
}

export async function untripRunbook(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  const id = formData.get("id")
  if (typeof id !== "string" || !id) throw new Error("Missing runbook id")
  const runbook = await prisma.fl_Runbook.findUnique({ where: { id } })
  if (!runbook) throw new Error("Runbook not found")
  if (!runbook.isTripped) return  // idempotent — untrip of an un-tripped runbook is a no-op
  await writeAudit({
    actorEmail: ctx.email,
    action: "runbook.untripped",
    outcome: "ok",
    detail: {
      runbookId: id,
      runbookName: runbook.name,
      prevReason: runbook.trippedReason,
      trippedAt: runbook.trippedAt?.toISOString() ?? null,
    },
  })
  await prisma.fl_Runbook.update({
    where: { id },
    data: { isTripped: false, trippedReason: null, trippedAt: null },
  })
  revalidatePath("/runbooks")
  revalidatePath(`/runbooks/${id}`)
}
