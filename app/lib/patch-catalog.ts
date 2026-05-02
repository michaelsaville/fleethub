import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// Phase 4 step 5 — patch catalog mutations.
//
// Approval is the gate that converts a missing-patch row from "data we
// surface on the Vulnerable dashboard" into "operator can launch a
// deploy." Decline + defer are tracked so the audit chain shows who
// chose to leave a CVE open and why.
//
// Multi-tenant approval (different tenants approving differently)
// becomes Phase 4.5 — would split this off into a Fl_PatchApproval
// table. v1 stores it on the row.

export type PatchApprovalState =
  | "approved"
  | "declined"
  | "deferred"
  | "needs-approval"

const VALID_STATES: PatchApprovalState[] = [
  "approved",
  "declined",
  "deferred",
  "needs-approval",
]

export function isPatchApprovalState(s: string): s is PatchApprovalState {
  return (VALID_STATES as string[]).includes(s)
}

export async function setPatchApproval(
  patchId: string,
  state: PatchApprovalState,
  by: string,
  notes?: string,
) {
  const isResolved = state === "approved" || state === "declined"
  const patch = await prisma.fl_Patch.update({
    where: { id: patchId },
    data: {
      approvalState: state,
      approvedBy: isResolved ? by : null,
      approvedAt: isResolved ? new Date() : null,
      notes: notes ?? null,
    },
  })
  await writeAudit({
    actorEmail: by,
    action: `patch.approval.${state}`,
    outcome: "ok",
    detail: {
      patchId: patch.id,
      source: patch.source,
      sourceId: patch.sourceId,
      isKev: patch.isKev,
      notes: notes ?? null,
    },
  })
  return patch
}
