"use server"

import { createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { requireSession } from "@/lib/authz"
import { mintAccessToken, RustDeskFreeMode, rustDeskDeepLink } from "@/lib/rustdesk"

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
  deepLink: string
  mode: "pro" | "free"
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
    select: { id: true, hostname: true, clientName: true, rustdeskId: true },
  })
  if (!device) throw new Error(`Device ${deviceId} not found`)
  if (!device.rustdeskId) {
    throw new Error("This device has no RustDesk peer ID stored. Set Fl_Device.rustdeskId before opening a session.")
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
      deviceRustdeskId: device.rustdeskId,
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
    deepLink: rustDeskDeepLink(device.rustdeskId, rawAccessToken),
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
