import "server-only"
import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyStepUpToken } from "@/lib/crypto-key"

// Phase 11 WS-C.5 — step-up token consumer. Disclose + approve verbs
// require `X-FleetHub-StepUp: <token>` header on the request. This
// helper verifies the token signature, checks Fl_StepUpConsumed for
// replay, and records the consumption.
//
// Single-use: a token may only successfully consume ONCE. Subsequent
// attempts with the same jti fail.

export type ConsumeStepUpResult =
  | { ok: true; userId: string }
  | { ok: false; reason: string; status: number }

const STEP_UP_HEADER = "X-FleetHub-StepUp"

/** Read + consume the step-up token from the request. Caller passes
 *  the session userId to bind the token's owner to the acting user
 *  (a token from one user cannot authorize another's disclose). */
export async function consumeStepUp(
  req: NextRequest,
  actingUserId: string,
): Promise<ConsumeStepUpResult> {
  const token = req.headers.get(STEP_UP_HEADER) ?? req.headers.get(STEP_UP_HEADER.toLowerCase())
  if (!token) {
    return { ok: false, reason: "step-up token required", status: 401 }
  }
  const verified = await verifyStepUpToken(token)
  if (!verified.ok) {
    return { ok: false, reason: `step-up: ${verified.reason}`, status: 401 }
  }
  if (verified.payload.userId !== actingUserId) {
    return { ok: false, reason: "step-up token for different user", status: 403 }
  }
  // Replay guard: try to claim the jti. Unique PK on Fl_StepUpConsumed
  // means a duplicate insert throws P2002, which we surface as 409.
  try {
    await prisma.fl_StepUpConsumed.create({
      data: {
        jti: verified.payload.jti,
        userId: verified.payload.userId,
        expMs: BigInt(verified.payload.expMs),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return { ok: false, reason: "step-up token already used", status: 409 }
    }
    return { ok: false, reason: `step-up consume failed: ${msg}`, status: 500 }
  }
  return { ok: true, userId: verified.payload.userId }
}

export { STEP_UP_HEADER }
