import { NextResponse } from "next/server"
import { requireRoleResponse } from "@/lib/authz"
import { listTickethubClientCandidates } from "@/lib/tickethub-clients"

// Feeds the /clients/new picker: every active TicketHub business client,
// flagged when it already exists as a FleetHub tenant.
export const dynamic = "force-dynamic"

export async function GET() {
  const gate = await requireRoleResponse("TECH")
  if ("response" in gate) return gate.response
  return NextResponse.json({ clients: await listTickethubClientCandidates() })
}
