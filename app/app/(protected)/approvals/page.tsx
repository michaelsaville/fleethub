import { prisma } from "@/lib/prisma"
import { requireSession } from "@/lib/authz"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { EmptyState } from "@/components/ui/EmptyState"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import ApprovalRow from "./ApprovalRow"

// Phase 11 WS-B.2 — pending-approvals inbox. ADMIN sees all; non-
// admin sees their own requests (so requester can monitor + cancel).

export const dynamic = "force-dynamic"

export default async function ApprovalsPage() {
  const session = await requireSession()
  const isAdmin = session.role === "ADMIN"
  const rows = await prisma.fl_ActionApproval.findMany({
    where: {
      state: { in: ["pending", "approved"] },
      ...(isAdmin ? {} : { requestedBy: session.email }),
    },
    orderBy: { requestedAt: "desc" },
    take: 100,
  })

  // Also surface the last 50 recent decisions for context.
  const recent = await prisma.fl_ActionApproval.findMany({
    where: {
      state: { in: ["denied", "expired", "consumed"] },
      ...(isAdmin ? {} : { requestedBy: session.email }),
    },
    orderBy: { requestedAt: "desc" },
    take: 50,
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={TYPOGRAPHY.H1}>Approvals</h1>
        <div style={TYPOGRAPHY.HINT}>
          {isAdmin
            ? "You can approve or deny any pending request."
            : "Your pending requests. Approval comes from another admin."}
        </div>
        <Card>
          <CardHeader title={`Pending (${rows.length})`} />
          {rows.length === 0 ? (
            <EmptyState
              title="Nothing waiting"
              body="When a bulk dispatch, shell-open, or sensitive credential action requires peer review, it lands here."
            />
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((r) => (
                <ApprovalRow
                  key={r.id}
                  approval={{
                    id: r.id,
                    action: r.action,
                    tenantName: r.tenantName,
                    payloadJson: r.payloadJson,
                    requestedBy: r.requestedBy,
                    requestedAt: r.requestedAt.toISOString(),
                    scope: r.scope,
                    state: r.state,
                    expiresAt: r.expiresAt.toISOString(),
                    approverEmail: r.approverEmail,
                  }}
                  isAdmin={isAdmin}
                  viewerEmail={session.email}
                />
              ))}
            </ul>
          )}
        </Card>

        {recent.length > 0 && (
          <Card>
            <CardHeader title={`Recent (${recent.length})`} />
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {recent.map((r) => (
                <li
                  key={r.id}
                  style={{
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 600, textTransform: "uppercase", fontSize: 10 }}>
                    {r.state}
                  </span>
                  <span>{r.action}</span>
                  <span>· {r.tenantName}</span>
                  <span>· {r.requestedBy}</span>
                  <span style={{ marginLeft: "auto" }}>{new Date(r.requestedAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
