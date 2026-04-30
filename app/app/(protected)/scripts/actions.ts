"use server"

import { createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { writeAudit } from "@/lib/audit"

const ALLOWED_SHELLS = ["powershell", "bash", "batch"] as const
type Shell = (typeof ALLOWED_SHELLS)[number]

function assertShell(raw: FormDataEntryValue | null): Shell {
  const s = String(raw ?? "")
  if (!ALLOWED_SHELLS.includes(s as Shell)) {
    throw new Error(`Invalid shell: ${s}`)
  }
  return s as Shell
}

function signBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex")
}

interface ScriptInput {
  name: string
  shell: Shell
  description: string | null
  category: string | null
  body: string
  isCurated: boolean
}

function readScriptInput(formData: FormData): ScriptInput {
  const name = String(formData.get("name") ?? "").trim()
  if (!name) throw new Error("Name required")
  const body = String(formData.get("body") ?? "")
  if (!body.trim()) throw new Error("Script body required")
  return {
    name,
    shell: assertShell(formData.get("shell")),
    description: (String(formData.get("description") ?? "").trim() || null),
    category: (String(formData.get("category") ?? "").trim() || null),
    body,
    isCurated: formData.get("isCurated") === "on",
  }
}

export async function createScript(formData: FormData) {
  const ctx = await requireAdmin()
  const input = readScriptInput(formData)
  const signedHash = signBody(input.body)
  const now = new Date()

  const created = await prisma.fl_Script.create({
    data: {
      ...input,
      signedHash,
      signedBy: ctx.email,
      signedAt: now,
    },
  })

  await writeAudit({
    actorEmail: ctx.email,
    action: "script.create",
    outcome: "ok",
    detail: {
      scriptId: created.id,
      name: created.name,
      shell: created.shell,
      isCurated: created.isCurated,
      signedHash,
    },
  })

  revalidatePath("/scripts")
  redirect(`/scripts/${created.id}`)
}

export async function updateScript(formData: FormData) {
  const ctx = await requireAdmin()
  const id = String(formData.get("id") ?? "")
  if (!id) throw new Error("Missing id")

  const existing = await prisma.fl_Script.findUnique({ where: { id } })
  if (!existing) throw new Error("Script not found")

  const input = readScriptInput(formData)
  const newHash = signBody(input.body)
  const bodyChanged = newHash !== existing.signedHash

  await prisma.fl_Script.update({
    where: { id },
    data: {
      ...input,
      signedHash: newHash,
      // Re-sign on every save by ADMIN — body change or no, the admin
      // is re-attesting at save time per HIPAA-READY signed-script rule.
      signedBy: ctx.email,
      signedAt: new Date(),
    },
  })

  await writeAudit({
    actorEmail: ctx.email,
    action: bodyChanged ? "script.update.body" : "script.update.metadata",
    outcome: "ok",
    detail: {
      scriptId: id,
      name: input.name,
      bodyChanged,
      newHash,
    },
  })

  revalidatePath("/scripts")
  revalidatePath(`/scripts/${id}`)
}

export async function toggleScriptActive(formData: FormData) {
  const ctx = await requireAdmin()
  const id = String(formData.get("id") ?? "")
  if (!id) throw new Error("Missing id")

  const existing = await prisma.fl_Script.findUnique({ where: { id } })
  if (!existing) throw new Error("Script not found")

  const nextActive = !existing.isActive
  await prisma.fl_Script.update({ where: { id }, data: { isActive: nextActive } })
  await writeAudit({
    actorEmail: ctx.email,
    action: nextActive ? "script.activate" : "script.deactivate",
    outcome: "ok",
    detail: { scriptId: id, name: existing.name },
  })
  revalidatePath("/scripts")
  revalidatePath(`/scripts/${id}`)
}
