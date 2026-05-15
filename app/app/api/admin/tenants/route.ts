import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import { findTickethubClientByName } from "@/lib/tickethub-clients"

// POST creates an Fl_Tenant row in advance of agent enrollment. Useful
// when an operator wants the client to appear in /clients before any
// device has phoned in. All other tenant config (HIPAA, reporting,
// branding) stays on the per-name PATCH route.
//
// Body: { name: string }

export async function POST(req: NextRequest) {
  await requireSession()

  const body = (await req.json().catch(() => ({}))) as { name?: unknown }
  const raw = typeof body.name === "string" ? body.name.trim() : ""

  if (!raw) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }
  if (raw.length > 100) {
    return NextResponse.json({ error: "name must be 100 characters or fewer" }, { status: 400 })
  }

  // Cross-schema guard: client must already exist in TicketHub as a
  // TH_Client. FleetHub's clientName field is documented to be byte-
  // equal to TH_Client.name (see app/lib/clients.ts header), so use
  // TH's canonical casing — not the operator's free-text input.
  const thClient = await findTickethubClientByName(raw)
  if (!thClient) {
    return NextResponse.json(
      {
        error:
          `No TH_Client named "${raw}" found in TicketHub. ` +
          `Create the client in TicketHub first, then return here.`,
      },
      { status: 422 },
    )
  }
  const canonicalName = thClient.name

  try {
    const tenant = await prisma.fl_Tenant.create({
      data: { name: canonicalName },
      select: { name: true, createdAt: true },
    })
    return NextResponse.json({ tenant }, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "A client with that name already exists" }, { status: 409 })
    }
    throw e
  }
}
