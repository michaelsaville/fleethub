import Link from "next/link"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { addStaff, updateStaffRole, toggleStaffActive } from "./actions"

export const dynamic = "force-dynamic"

const ROLES = ["ADMIN", "TECH", "VIEWER"] as const

export default async function StaffPage() {
  const ctx = await requireAdmin()
  const rows = await prisma.fl_StaffUser.findMany({
    orderBy: [{ isActive: "desc" }, { email: "asc" }],
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <header>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            <Link href="/setup" style={{ color: "inherit", textDecoration: "none" }}>← Setup</Link>
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Staff &amp; roles
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Sign-in allowlist for FleetHub. Email match is case-insensitive. Every change writes to the audit log.
          </p>
        </header>

        <section
          style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "10px",
            padding: "16px",
          }}
        >
          <div style={sectionLabelStyle}>Add staff</div>
          <form
            action={addStaff}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px, 1fr) minmax(160px, 1fr) 120px auto",
              gap: "8px",
              alignItems: "end",
            }}
          >
            <Field label="Email">
              <input type="email" name="email" required placeholder="user@pcc2k.com" style={inputStyle} />
            </Field>
            <Field label="Name">
              <input type="text" name="name" placeholder="Optional" style={inputStyle} />
            </Field>
            <Field label="Role">
              <select name="role" defaultValue="TECH" style={inputStyle}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
            <button type="submit" style={primaryButtonStyle}>Add</button>
          </form>
        </section>

        <section
          style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <div style={{ ...sectionLabelStyle, padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)", margin: 0 }}>
            {rows.length} {rows.length === 1 ? "user" : "users"}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ color: "var(--color-text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSelf = r.email === ctx.email
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderTop: "0.5px solid var(--color-border-tertiary)",
                      opacity: r.isActive ? 1 : 0.55,
                    }}
                  >
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>{r.email}</span>
                        {isSelf && <span style={selfBadgeStyle}>you</span>}
                      </div>
                    </td>
                    <td style={tdStyle}>{r.name ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}</td>
                    <td style={tdStyle}>
                      <form action={updateStaffRole} style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <select
                          name="role"
                          defaultValue={r.role}
                          style={{ ...inputStyle, padding: "4px 6px", fontSize: "12px", width: "auto" }}
                          disabled={isSelf && r.role === "ADMIN"}
                          title={isSelf && r.role === "ADMIN" ? "You can't demote your own ADMIN role" : undefined}
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          style={smallButtonStyle}
                          disabled={isSelf && r.role === "ADMIN"}
                        >
                          Save
                        </button>
                      </form>
                    </td>
                    <td style={tdStyle}>
                      <span style={r.isActive ? activePillStyle : inactivePillStyle}>
                        {r.isActive ? "active" : "inactive"}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <form action={toggleStaffActive} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          type="submit"
                          style={smallButtonStyle}
                          disabled={isSelf && r.isActive}
                          title={isSelf && r.isActive ? "You can't deactivate yourself" : undefined}
                        >
                          {r.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, color: "var(--color-text-muted)", textAlign: "center", padding: "24px" }}>
                    No staff configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </AppShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  marginBottom: "10px",
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-background-tertiary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "6px",
  padding: "6px 10px",
  color: "var(--color-text-primary)",
  fontSize: "13px",
  fontFamily: "inherit",
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "7px 16px",
  background: "var(--color-accent)",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
}

const smallButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "transparent",
  color: "var(--color-text-secondary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "5px",
  fontSize: "11px",
  cursor: "pointer",
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 16px",
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: "10px 16px",
  color: "var(--color-text-primary)",
}

const activePillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 500,
  background: "var(--color-success-soft, rgba(34, 197, 94, 0.15))",
  color: "var(--color-success)",
}

const inactivePillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 500,
  background: "var(--color-background-tertiary)",
  color: "var(--color-text-muted)",
}

const selfBadgeStyle: React.CSSProperties = {
  fontSize: "9px",
  padding: "1px 6px",
  borderRadius: "999px",
  background: "var(--color-accent-soft)",
  color: "var(--color-accent)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  fontWeight: 600,
}
