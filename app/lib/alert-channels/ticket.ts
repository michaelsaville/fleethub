import "server-only"
import { createAutoTicket } from "@/lib/auto-ticket"
import { prisma } from "@/lib/prisma"
import type { AlertChannelAdapter } from "./types"

// Phase 8 Workstream C §5.2 — TicketHub auto-ticket adapter. No
// per-route config in v1; the TH side decides board + priority
// from severity + kind. Hostname resolution happens here for
// the TH-side ticket-body context (saves a cross-app lookup).

export const ticketAdapter: AlertChannelAdapter = {
  type: "ticket",
  async send(alert) {
    let hostname: string | null = null
    if (alert.deviceId) {
      const d = await prisma.fl_Device.findUnique({
        where: { id: alert.deviceId },
        select: { hostname: true },
      })
      hostname = d?.hostname ?? null
    }
    const ticket = await createAutoTicket({
      alertId: alert.id,
      clientName: alert.clientName,
      deviceId: alert.deviceId,
      hostname,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
    })
    return {
      destination: `TH #${ticket.ticketNumber}${ticket.created ? "" : " (existing)"}`,
      externalId: ticket.ticketId,
    }
  },
}
