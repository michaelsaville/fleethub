import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"
import { queryRustDeskSession, rustDeskMode, RustDeskFreeMode } from "@/lib/rustdesk"
import { withCronAuth } from "@/lib/with-cron-auth"

// Phase 7 Workstream C step 2 — remote session watcher cron.
//
// Polls Fl_RemoteSession rows in state="in-progress" with a
// non-null rustdeskSessionId (= Pro-mode sessions) and asks the
// RustDesk Pro management API whether the session has actually
// ended. When yes, flips state="closed" + records
// bytesTransferred + endedAt + writes a remote.session.closed
// audit row.
//
// Free-mode sessions don't have a rustdeskSessionId so they
// won't be selected here — they rely on the operator's
// "Mark as closed" click for terminal state.
//
// Also catches Pro-mode sessions whose accessTokenExpiresAt is
// in the past + state is still "in-progress" — those get
// flipped to "expired" so the dashboard doesn't show stale
// "in-progress" forever when an operator forgets to close.
//
// Cadence: every 1 minute alongside the other Phase 7 crons.
// Bearer-gated with FLEETHUB_AGENT_SECRET.

export const dynamic = "force-dynamic"
export const maxDuration = 60

const BATCH = 100

const handler = withCronAuth<NextRequest>(async (req) => {

  const now = new Date()
  const mode = rustDeskMode()

  // Path 1: expire any Pro session whose token TTL has passed
  // without operator close. Runs in both modes — even free-mode
  // sessions can have accessTokenExpiresAt set if a Pro→free
  // downgrade happened mid-session.
  const expired = await prisma.fl_RemoteSession.updateMany({
    where: {
      state: "in-progress",
      accessTokenExpiresAt: { lt: now, not: null },
    },
    data: { state: "expired", endedAt: now },
  })

  // Path 2: ask RustDesk Pro about active sessions. Free-mode
  // short-circuits — nothing to ask.
  let closed = 0
  const errors: string[] = []
  if (mode === "pro") {
    const live = await prisma.fl_RemoteSession.findMany({
      where: {
        state: "in-progress",
        rustdeskSessionId: { not: null },
      },
      orderBy: { startedAt: "asc" },
      take: BATCH,
      select: { id: true, deviceId: true, rustdeskSessionId: true },
    })
    for (const s of live) {
      try {
        const result = await queryRustDeskSession(s.rustdeskSessionId!)
        if (result.state !== "ended") continue
        await prisma.fl_RemoteSession.update({
          where: { id: s.id },
          data: {
            state: "closed",
            endedAt: result.endedAt ?? now,
            bytesTransferred: result.bytesTransferred != null ? BigInt(result.bytesTransferred) : null,
          },
        })
        const device = await prisma.fl_Device.findUnique({
          where: { id: s.deviceId },
          select: { clientName: true, hostname: true },
        })
        await writeAudit({
          clientName: device?.clientName ?? null,
          deviceId: s.deviceId,
          action: "remote.session.closed",
          outcome: "ok",
          detail: {
            sessionId: s.id,
            hostname: device?.hostname,
            closedBy: "rustdesk-api",
            bytesTransferred: result.bytesTransferred,
          },
        })
        closed++
      } catch (err) {
        if (err instanceof RustDeskFreeMode) break  // mode flipped mid-run; bail
        errors.push(`${s.id}: ${(err as Error).message.slice(0, 200)}`)
      }
    }
  }

  return NextResponse.json({
    sweptAt: now.toISOString(),
    mode,
    expired: expired.count,
    closed,
    errors,
  })
})

export const GET = handler
export const POST = handler
