import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { withAudit } from "@/lib/with-audit"
import { dispatchToAgent } from "@/lib/agent-dispatch"

// Phase 9 WS-D §6.1 — close an interactive shell session.

export const dynamic = "force-dynamic"

export const POST = withAudit(
  { action: "shell.close" },
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireAdmin()
    const { id } = await params
    const sess = await prisma.fl_ShellSession.findUnique({
      where: { id },
      include: { device: { select: { agentId: true } } },
    })
    if (!sess) return NextResponse.json({ error: "session not found" }, { status: 404 })
    if (sess.state !== "open") {
      return NextResponse.json({ ok: true, alreadyClosed: true })
    }

    if (sess.device.agentId) {
      await dispatchToAgent({
        agentId: sess.device.agentId,
        method: "shell.close",
        params: { sessionId: sess.id, reason: "operator" },
      })
    }
    await prisma.fl_ShellSession.update({
      where: { id },
      data: { state: "closed", closedAt: new Date(), exitReason: "operator" },
    })
    return NextResponse.json({ ok: true })
  },
)
