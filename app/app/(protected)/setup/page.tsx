import Link from "next/link"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import { getSessionContext } from "@/lib/authz"

export const dynamic = "force-dynamic"

export default async function SetupPage() {
  const ctx = await getSessionContext()
  const isAdmin = ctx?.role === "ADMIN"
  const staffCount = await prisma.fl_StaffUser.count({ where: { isActive: true } })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Setup
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Tenant configuration. Staff allowlist is live; the rest activate as their phases land.
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "12px",
          }}
        >
          <SetupCard
            href="/setup/staff"
            label="Staff & roles"
            status={`${staffCount} active`}
            description="Manage who can sign in to FleetHub and what role they hold."
            disabled={!isAdmin}
            disabledHint={!isAdmin ? "ADMIN-only" : undefined}
          />
          <SetupCard
            href="#"
            label="Agent enrollment"
            status="Phase 1"
            description="Issue enrollment tokens, view connected agents, revoke compromised hosts."
            disabled
          />
          <SetupCard
            href="#"
            label="Integrations"
            status="Phase 1"
            description="DocHub assets, TicketHub clients, Microsoft Graph for inventory."
            disabled
          />
          <SetupCard
            href="#"
            label="Alert routing"
            status="Phase 1"
            description="Per-client severity thresholds, on-call rotation, mute windows."
            disabled
          />
          <SetupCard
            href="/audit"
            label="Audit log"
            status={isAdmin ? "live" : "ADMIN-only"}
            description="Hash-chained record of every privileged action; filter by actor, action, outcome, or date. Verify chain integrity on demand."
            disabled={!isAdmin}
            disabledHint={!isAdmin ? "ADMIN-only" : undefined}
          />
        </section>
      </div>
    </AppShell>
  )
}

function SetupCard({
  href,
  label,
  status,
  description,
  disabled,
  disabledHint,
}: {
  href: string
  label: string
  status: string
  description: string
  disabled?: boolean
  disabledHint?: string
}) {
  const inner = (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>{label}</div>
        <div style={{ fontSize: "10px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {disabledHint ?? status}
        </div>
      </div>
      <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{description}</div>
    </>
  )
  const baseStyle: React.CSSProperties = {
    display: "block",
    padding: "16px 18px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "10px",
    textDecoration: "none",
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  }
  if (disabled) {
    return <div style={baseStyle}>{inner}</div>
  }
  return (
    <Link href={href} style={baseStyle}>
      {inner}
    </Link>
  )
}
