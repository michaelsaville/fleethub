"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireAdmin, type StaffRole } from "@/lib/authz"
import { writeAudit } from "@/lib/audit"

const ALLOWED_ROLES: StaffRole[] = ["ADMIN", "TECH", "VIEWER"]

function normalizeEmail(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim().toLowerCase()
}

function assertRole(raw: FormDataEntryValue | null): StaffRole {
  const r = String(raw ?? "")
  if (!ALLOWED_ROLES.includes(r as StaffRole)) {
    throw new Error(`Invalid role: ${r}`)
  }
  return r as StaffRole
}

export async function addStaff(formData: FormData) {
  const ctx = await requireAdmin()
  const email = normalizeEmail(formData.get("email"))
  const name = String(formData.get("name") ?? "").trim() || null
  const role = assertRole(formData.get("role"))

  if (!email || !email.includes("@")) {
    throw new Error("Invalid email")
  }

  const existing = await prisma.fl_StaffUser.findUnique({ where: { email } })
  if (existing) {
    // Reactivate + update role rather than blowing up — the common case
    // is "I deactivated this person and they're rejoining."
    await prisma.fl_StaffUser.update({
      where: { email },
      data: { name, role, isActive: true },
    })
    await writeAudit({
      actorEmail: ctx.email,
      action: "staff.reactivate",
      outcome: "ok",
      detail: { email, role, name },
    })
  } else {
    await prisma.fl_StaffUser.create({
      data: { email, name, role, isActive: true },
    })
    await writeAudit({
      actorEmail: ctx.email,
      action: "staff.add",
      outcome: "ok",
      detail: { email, role, name },
    })
  }

  revalidatePath("/setup/staff")
  revalidatePath("/setup")
}

export async function updateStaffRole(formData: FormData) {
  const ctx = await requireAdmin()
  const id = String(formData.get("id") ?? "")
  const role = assertRole(formData.get("role"))
  if (!id) throw new Error("Missing id")

  const existing = await prisma.fl_StaffUser.findUnique({ where: { id } })
  if (!existing) throw new Error("Staff user not found")

  if (existing.email === ctx.email && existing.role === "ADMIN" && role !== "ADMIN") {
    // Don't let an ADMIN demote themselves — easy way to lock everyone out.
    throw new Error("You cannot demote your own ADMIN role")
  }

  await prisma.fl_StaffUser.update({ where: { id }, data: { role } })
  await writeAudit({
    actorEmail: ctx.email,
    action: "staff.role.change",
    outcome: "ok",
    detail: { email: existing.email, from: existing.role, to: role },
  })
  revalidatePath("/setup/staff")
}

export async function toggleStaffActive(formData: FormData) {
  const ctx = await requireAdmin()
  const id = String(formData.get("id") ?? "")
  if (!id) throw new Error("Missing id")

  const existing = await prisma.fl_StaffUser.findUnique({ where: { id } })
  if (!existing) throw new Error("Staff user not found")

  if (existing.email === ctx.email && existing.isActive) {
    throw new Error("You cannot deactivate your own account")
  }

  const nextActive = !existing.isActive
  await prisma.fl_StaffUser.update({ where: { id }, data: { isActive: nextActive } })
  await writeAudit({
    actorEmail: ctx.email,
    action: nextActive ? "staff.activate" : "staff.deactivate",
    outcome: "ok",
    detail: { email: existing.email, role: existing.role },
  })
  revalidatePath("/setup/staff")
  revalidatePath("/setup")
}
