import "server-only"
import { prisma } from "@/lib/prisma"
import { getDevice } from "@/lib/devices"
import {
  controlrDeviceUrl,
  controlrLogonTokensEnabled,
  createControlRLogonToken,
} from "@/lib/controlr"

// Remote-session workspace (2026-09-13) — the Datto-style split view:
// ControlR's viewer on the right, everything FleetHub/TicketHub know about
// the machine on the left. All of the left side comes from the shared
// Postgres (tickethub.* via $queryRaw — no Prisma model on this side), so
// it is live and costs nothing.

const TOKEN_TTL_MIN = 5
const OPEN_TICKET_STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "ONSITE_PENDING_DISPATCH", "WAITING_CUSTOMER", "WAITING_THIRD_PARTY"]

export interface WorkspaceContact {
  id: string
  firstName: string
  lastName: string
  jobTitle: string | null
  email: string | null
  phone: string | null
  mobilePhone: string | null
  officePhone: string | null
  officePhoneExt: string | null
  afterHoursPhone: string | null
  isPrimary: boolean
  isHelpdesk: boolean
}

export interface WorkspaceTicket {
  id: string
  ticketNumber: number
  title: string
  status: string
  priority: string
  updatedAt: string
  /** True when the ticket is linked to THIS device (TH_Ticket.fleetDeviceId). */
  onDevice: boolean
}

export interface WorkspaceClient {
  id: string
  name: string
  shortCode: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  businessHoursStart: string | null
  businessHoursEnd: string | null
  contacts: WorkspaceContact[]
  tickets: WorkspaceTicket[]
  ticketHubUrl: string
  newTicketUrl: string
}

async function loadTicketHubClient(clientName: string, fleetDeviceId: string, hostname: string): Promise<WorkspaceClient | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      name: string
      shortCode: string | null
      billingStreet: string | null
      billingCity: string | null
      billingState: string | null
      billingZip: string | null
      businessHoursStart: string | null
      businessHoursEnd: string | null
    }>
  >`
    SELECT id, name, "shortCode", "billingStreet", "billingCity", "billingState", "billingZip",
           "businessHoursStart", "businessHoursEnd"
      FROM tickethub.th_clients
     WHERE lower(name) = lower(${clientName}) AND "isActive"
     ORDER BY "createdAt" ASC
     LIMIT 1
  `
  const c = rows[0]
  if (!c) return null

  const [contacts, tickets] = await Promise.all([
    prisma.$queryRaw<WorkspaceContact[]>`
      SELECT id, "firstName", "lastName", "jobTitle", email, phone, "mobilePhone", "officePhone",
             "officePhoneExt", "afterHoursPhone", "isPrimary", "isHelpdesk"
        FROM tickethub.th_contacts
       WHERE "clientId" = ${c.id} AND "isActive"
       ORDER BY "isPrimary" DESC, "isHelpdesk" DESC, "lastName" ASC
       LIMIT 12
    `,
    prisma.$queryRaw<Array<Omit<WorkspaceTicket, "updatedAt" | "onDevice"> & { updatedAt: Date; fleetDeviceId: string | null }>>`
      SELECT id, "ticketNumber", title, status::text AS status, priority::text AS priority, "updatedAt", "fleetDeviceId"
        FROM tickethub.th_tickets
       WHERE "clientId" = ${c.id} AND "deletedAt" IS NULL
         AND status::text IN (${OPEN_TICKET_STATUSES[0]}, ${OPEN_TICKET_STATUSES[1]}, ${OPEN_TICKET_STATUSES[2]}, ${OPEN_TICKET_STATUSES[3]}, ${OPEN_TICKET_STATUSES[4]}, ${OPEN_TICKET_STATUSES[5]})
       ORDER BY ("fleetDeviceId" = ${fleetDeviceId}) DESC, "updatedAt" DESC
       LIMIT 15
    `,
  ])

  const th = process.env.TICKETHUB_PUBLIC_URL?.trim().replace(/\/$/, "") || "https://tickethub.pcc2k.com"
  const newTicket = new URL(`${th}/tickets/new`)
  newTicket.searchParams.set("clientId", c.id)
  newTicket.searchParams.set("title", `${hostname}: `)
  newTicket.searchParams.set("description", `Remote session on ${hostname} (FleetHub device ${fleetDeviceId}).\n\n`)

  return {
    id: c.id,
    name: c.name,
    shortCode: c.shortCode,
    street: c.billingStreet,
    city: c.billingCity,
    state: c.billingState,
    zip: c.billingZip,
    businessHoursStart: c.businessHoursStart,
    businessHoursEnd: c.businessHoursEnd,
    contacts,
    tickets: tickets.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      title: t.title,
      status: t.status,
      priority: t.priority,
      updatedAt: t.updatedAt.toISOString(),
      onDevice: t.fleetDeviceId === fleetDeviceId,
    })),
    ticketHubUrl: th,
    newTicketUrl: newTicket.toString(),
  }
}

export async function loadSessionWorkspace(sessionId: string, operatorEmail: string, isAdmin: boolean) {
  const session = await prisma.fl_RemoteSession.findUnique({ where: { id: sessionId } })
  if (!session) return { error: "Session not found" as const }
  if (session.operatorEmail !== operatorEmail && !isAdmin) return { error: "This session belongs to another operator" as const }

  const [device, raw] = await Promise.all([
    getDevice(session.deviceId),
    prisma.fl_Device.findUnique({
      where: { id: session.deviceId },
      select: { controlrDeviceId: true, rustdeskId: true, assetTag: true, clientName: true, hostname: true },
    }),
  ])
  if (!device || !raw) return { error: "Device not found" as const }

  const [client, previous, tenant] = await Promise.all([
    loadTicketHubClient(raw.clientName, device.id, raw.hostname),
    prisma.fl_RemoteSession.findMany({
      where: { deviceId: device.id, id: { not: sessionId } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, operatorEmail: true, startedAt: true, endedAt: true, state: true, provider: true, justification: true, notes: true },
    }),
    prisma.fl_Tenant.findUnique({ where: { name: raw.clientName }, select: { remoteRequiresJustification: true } }),
  ])

  // Viewer URL. Live session + ControlR → a fresh single-use token every
  // render (a reload of this page is a new ControlR session; that's fine
  // and audited by ControlR under the same sessionCorrelationId).
  let viewerUrl: string | null = null
  let viewerError: string | null = null
  const live = session.state === "in-progress" || session.state === "issued"
  if (live && session.provider === "controlr" && raw.controlrDeviceId) {
    try {
      viewerUrl = controlrLogonTokensEnabled()
        ? (
            await createControlRLogonToken({
              controlrDeviceId: raw.controlrDeviceId,
              operatorEmail,
              operatorName: null,
              sessionId: session.id,
              expirationMinutes: TOKEN_TTL_MIN,
            })
          ).deviceAccessUrl
        : controlrDeviceUrl(raw.controlrDeviceId)
    } catch (e) {
      viewerError = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    session: {
      id: session.id,
      state: session.state,
      provider: session.provider,
      operatorEmail: session.operatorEmail,
      justification: session.justification,
      startedAt: session.startedAt?.toISOString() ?? session.createdAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      notes: session.notes ?? "",
      notesTicketId: session.notesTicketId,
    },
    device: {
      id: device.id,
      hostname: device.hostname,
      friendlyName: device.friendlyName,
      clientName: device.clientName,
      os: device.os,
      osVersion: device.osVersion,
      role: device.role,
      ipAddress: device.ipAddress,
      isOnline: device.isOnline,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      alertCount: device.alertCount,
      hasAgent: !!device.agentId,
      assetTag: raw.assetTag,
      hardware: device.inventory?.hardware ?? null,
      osInfo: device.inventory?.os ?? null,
      patches: device.inventory?.patches ?? null,
      controlrLinked: !!raw.controlrDeviceId,
    },
    client,
    previous: previous.map((p) => ({
      ...p,
      startedAt: p.startedAt?.toISOString() ?? null,
      endedAt: p.endedAt?.toISOString() ?? null,
    })),
    requiresJustification: tenant?.remoteRequiresJustification ?? false,
    viewerUrl,
    viewerError,
    live,
  }
}

export type SessionWorkspaceData = Exclude<Awaited<ReturnType<typeof loadSessionWorkspace>>, { error: string }>
