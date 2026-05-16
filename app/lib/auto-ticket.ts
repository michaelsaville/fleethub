import "server-only"
import { callTickethubBff, BffCallError } from "@/lib/bff-th-client"

// Phase 7 Workstream A step 7 — call TicketHub to auto-create a
// ticket from a routed alert. Uses the long-dormant
// `bff-th-client` HMAC pattern from Phase 1; the TH-side route
// at /api/bff/fleet/create-ticket is this caller's first
// consumer.
//
// FL_BFF_SECRET must be set + identical on both sides.

export interface AutoTicketInput {
  alertId: string
  clientName: string
  deviceId: string | null
  hostname: string | null
  kind: string
  severity: string
  title: string
}

export interface AutoTicketResult {
  ticketId: string
  ticketNumber: number
  created: boolean
}

export async function createAutoTicket(input: AutoTicketInput): Promise<AutoTicketResult> {
  const fleethubUrl = (process.env.FLEETHUB_PUBLIC_URL?.trim() || "https://fleethub.pcc2k.com").replace(/\/$/, "")
  try {
    const res = await callTickethubBff<{
      ok: boolean
      ticketId?: string
      ticketNumber?: number
      created?: boolean
      error?: string
    }>({
      path: "/api/bff/fleet/create-ticket",
      body: { ...input, fleethubUrl },
    })
    if (!res.ok || !res.ticketId || typeof res.ticketNumber !== "number") {
      throw new Error(res.error ?? "TicketHub auto-ticket returned unexpected shape")
    }
    return {
      ticketId: res.ticketId,
      ticketNumber: res.ticketNumber,
      created: res.created ?? false,
    }
  } catch (err) {
    if (err instanceof BffCallError) {
      const payload = err.payload as { error?: string } | undefined
      throw new Error(`TicketHub returned ${err.status}: ${payload?.error ?? "unknown"}`)
    }
    throw err
  }
}
