"use server"

import { createHash, randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { requireSession } from "@/lib/authz"
import { mintAccessToken, RustDeskFreeMode, rustDeskDeepLink } from "@/lib/rustdesk"
import { controlrConfigured, controlrLogonTokensEnabled, resolveControlRDeviceId } from "@/lib/controlr"

// Phase 7 Workstream C step 2 — server actions that own the
// open + close lifecycle of an Fl_RemoteSession. Hybrid: same
// code path tries Pro-mode mint first, falls back to free-mode
// operator-asserted lifecycle on RustDeskFreeMode.
//
// Authz: requireSession() — any signed-in tech can remote in.
// Per-tenant gating happens inside the action (the operator's
// scope tells them WHICH clients they can open sessions for;
// that's a future Phase 1.5 fleet_staff_client_scope concern).

const TOKEN_TTL_MIN = 5

export interface OpenRemoteSessionResult {
  sessionId: string
  /** rustdesk:// deep link, or (mode "controlr") an https URL to open in a new tab. */
  deepLink: string
  mode: "pro" | "free" | "controlr"
  justificationCaptured: boolean
}

export async function openRemoteSession(formData: FormData): Promise<OpenRemoteSessionResult> {
  const ctx = await requireSession()
  const deviceId = formData.get("deviceId")
  if (typeof deviceId !== "string" || !deviceId) throw new Error("Missing deviceId")
  const justification = typeof formData.get("justification") === "string"
    ? (formData.get("justification") as string).trim()
    : ""

  const device = await prisma.fl_Device.findUnique({
    where: { id: deviceId },
    select: { id: true, hostname: true, clientName: true, rustdeskId: true, controlrDeviceId: true },
  })
  if (!device) throw new Error(`Device ${deviceId} not found`)

  // Provider: ControlR when it's configured and knows this host (2026-09-13
  // — the browser viewer, no client install, scoped logon token); else the
  // original RustDesk flow. Both honour the same tenant gates below.
  const controlr = controlrConfigured() ? await resolveControlRDeviceId(device) : null
  if (!controlr && !device.rustdeskId) {
    throw new Error(
      controlrConfigured()
        ? "This device isn't enrolled in ControlR (no hostname match) and has no RustDesk peer ID."
        : "This device has no RustDesk peer ID stored. Set Fl_Device.rustdeskId before opening a session.",
    )
  }

  const tenant = await prisma.fl_Tenant.findUnique({
    where: { name: device.clientName },
    select: { remoteControlEnabled: true, remoteRequiresJustification: true },
  })
  // When no Fl_Tenant row exists yet, fall back to the defaults
  // (remoteControlEnabled=true, justification not required). Same
  // behavior as the existing /clients code path for un-pre-created
  // tenants — a session is allowed and writes will lazy-create
  // tenant config when an admin first opens /clients/[name]/settings.
  const remoteControlEnabled = tenant?.remoteControlEnabled ?? true
  const requiresJustification = tenant?.remoteRequiresJustification ?? false
  if (!remoteControlEnabled) {
    throw new Error(`Remote control is disabled for tenant "${device.clientName}".`)
  }
  if (requiresJustification && justification.length < 4) {
    throw new Error("This tenant requires a justification (≥4 chars) on every remote session.")
  }

  if (controlr) {
    if (controlr.device && !controlr.device.isOnline) {
      throw new Error(`${device.hostname} is offline in ControlR (last seen ${new Date(controlr.device.lastSeen).toLocaleString()}).`)
    }
    const session = await prisma.fl_RemoteSession.create({
      data: {
        deviceId: device.id,
        operatorEmail: ctx.email,
        provider: "controlr",
        justification: justification || null,
        state: "in-progress",
        startedAt: new Date(),
      },
      select: { id: true },
    })
    // The workspace page (/devices/[id]/session) mints the ControlR logon
    // token itself on every render, so nothing is minted here — the
    // launcher just opens the workspace in a new tab.
    const workspaceUrl = `/devices/${device.id}/session?s=${session.id}`
    await writeAudit({
      actorEmail: ctx.email,
      clientName: device.clientName,
      deviceId: device.id,
      action: "remote.session.opened",
      outcome: "ok",
      detail: {
        sessionId: session.id,
        mode: "controlr",
        controlrDeviceId: controlr.controlrDeviceId,
        hostname: device.hostname,
        hasJustification: !!justification,
        logonToken: controlrLogonTokensEnabled(),
        workspace: true,
      },
    })
    revalidatePath(`/devices/${device.id}`)
    revalidatePath("/remote-sessions")
    return {
      sessionId: session.id,
      deepLink: workspaceUrl,
      mode: "controlr",
      justificationCaptured: !!justification,
    }
  }

  // Try Pro first. RustDeskFreeMode means "no license configured" —
  // fall through to the operator-asserted path. Any OTHER error
  // (HTTP failure, malformed response) bubbles up so the operator
  // sees what went wrong instead of silently degrading.
  let mode: "pro" | "free" = "free"
  let rustdeskSessionId: string | null = null
  let accessTokenHash: string | null = null
  let accessTokenExpiresAt: Date | null = null
  let rawAccessToken: string | null = null
  try {
    const minted = await mintAccessToken({
      deviceRustdeskId: device.rustdeskId!,
      operatorEmail: ctx.email,
      ttlMin: TOKEN_TTL_MIN,
    })
    mode = "pro"
    rustdeskSessionId = minted.rustdeskSessionId
    accessTokenExpiresAt = minted.expiresAt
    rawAccessToken = minted.accessToken
    accessTokenHash = sha256(minted.accessToken)
  } catch (err) {
    if (!(err instanceof RustDeskFreeMode)) throw err
  }

  const session = await prisma.fl_RemoteSession.create({
    data: {
      deviceId: device.id,
      operatorEmail: ctx.email,
      rustdeskSessionId,
      accessTokenHash,
      accessTokenExpiresAt,
      justification: justification || null,
      state: "in-progress",
      startedAt: new Date(),
    },
    select: { id: true },
  })

  await writeAudit({
    actorEmail: ctx.email,
    clientName: device.clientName,
    deviceId: device.id,
    action: "remote.session.opened",
    outcome: "ok",
    detail: {
      sessionId: session.id,
      mode,
      rustdeskSessionId,
      hostname: device.hostname,
      hasJustification: !!justification,
      ttlMin: mode === "pro" ? TOKEN_TTL_MIN : null,
    },
  })

  revalidatePath(`/devices/${device.id}`)
  revalidatePath("/remote-sessions")

  return {
    sessionId: session.id,
    deepLink: rustDeskDeepLink(device.rustdeskId!, rawAccessToken),
    mode,
    justificationCaptured: !!justification,
  }
}

export async function markRemoteSessionClosed(formData: FormData): Promise<void> {
  const ctx = await requireSession()
  const sessionId = formData.get("sessionId")
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Missing sessionId")
  const session = await prisma.fl_RemoteSession.findUnique({
    where: { id: sessionId },
    select: { id: true, deviceId: true, state: true, operatorEmail: true },
  })
  if (!session) throw new Error("Session not found")
  if (session.state === "closed" || session.state === "expired" || session.state === "revoked") {
    return  // idempotent — already terminal
  }

  const device = await prisma.fl_Device.findUnique({
    where: { id: session.deviceId },
    select: { clientName: true, hostname: true },
  })

  await prisma.fl_RemoteSession.update({
    where: { id: sessionId },
    data: {
      state: "closed",
      endedAt: new Date(),
      assertedClose: true,
    },
  })

  await writeAudit({
    actorEmail: ctx.email,
    clientName: device?.clientName ?? null,
    deviceId: session.deviceId,
    action: "remote.session.closed",
    outcome: "ok",
    detail: {
      sessionId,
      hostname: device?.hostname,
      closedBy: "operator-assertion",
      originalOperator: session.operatorEmail,
    },
  })

  revalidatePath(`/devices/${session.deviceId}`)
  revalidatePath("/remote-sessions")
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex")
}

export interface SaveSessionNotesResult {
  ok: boolean
  error?: string
  postedToTicket?: number | null
}

/** Session-workspace notes. Always saved on the Fl_RemoteSession; when a
 *  TicketHub ticket is chosen, also posted there as an INTERNAL comment
 *  (cross-schema insert — TicketHub has no API for this and shares our
 *  Postgres). The comment author is the TicketHub user with the operator's
 *  email; no such user → saved locally only, with a clear error. */
export async function saveSessionNotes(input: {
  sessionId: string
  notes: string
  ticketId: string | null
}): Promise<SaveSessionNotesResult> {
  const ctx = await requireSession()
  const notes = input.notes.trim().slice(0, 8000)
  const session = await prisma.fl_RemoteSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, deviceId: true, operatorEmail: true, notesTicketId: true },
  })
  if (!session) return { ok: false, error: "Session not found" }
  if (session.operatorEmail !== ctx.email && ctx.role !== "ADMIN") return { ok: false, error: "Not your session" }

  await prisma.fl_RemoteSession.update({ where: { id: session.id }, data: { notes: notes || null } })
  if (!input.ticketId || !notes) return { ok: true, postedToTicket: null }

  const device = await prisma.fl_Device.findUnique({
    where: { id: session.deviceId },
    select: { hostname: true, clientName: true },
  })
  const ticket = await prisma.$queryRaw<Array<{ id: string; ticketNumber: number; clientName: string }>>`
    SELECT t.id, t."ticketNumber", c.name AS "clientName"
      FROM tickethub.th_tickets t JOIN tickethub.th_clients c ON c.id = t."clientId"
     WHERE t.id = ${input.ticketId} AND t."deletedAt" IS NULL
     LIMIT 1
  `
  if (!ticket[0]) return { ok: false, error: "Ticket not found" }
  if (device && ticket[0].clientName.toLowerCase() !== device.clientName.toLowerCase()) {
    return { ok: false, error: "That ticket belongs to a different client" }
  }
  const author = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM tickethub.th_users WHERE lower(email) = lower(${ctx.email}) AND "isActive" LIMIT 1
  `
  if (!author[0]) {
    return { ok: false, error: `Saved here, but not posted: no TicketHub user with email ${ctx.email}` }
  }
  const body = `🖥 Remote session notes — ${device?.hostname ?? "device"} (FleetHub session ${session.id}):\n\n${notes}`
  const commentId = `flrs_${randomUUID().replace(/-/g, "")}`
  await prisma.$executeRaw`
    INSERT INTO tickethub.th_ticket_comments (id, "ticketId", "authorId", body, "isInternal", "createdAt", "updatedAt")
    VALUES (${commentId}, ${ticket[0].id}, ${author[0].id}, ${body}, true, NOW(), NOW())
  `
  await prisma.$executeRaw`UPDATE tickethub.th_tickets SET "updatedAt" = NOW() WHERE id = ${ticket[0].id}`
  await prisma.fl_RemoteSession.update({ where: { id: session.id }, data: { notesTicketId: ticket[0].id } })
  await writeAudit({
    actorEmail: ctx.email,
    clientName: device?.clientName ?? null,
    deviceId: session.deviceId,
    action: "remote.session.notes_posted",
    outcome: "ok",
    detail: { sessionId: session.id, ticketId: ticket[0].id, ticketNumber: ticket[0].ticketNumber, chars: notes.length },
  })
  return { ok: true, postedToTicket: ticket[0].ticketNumber }
}
