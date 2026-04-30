import Link from "next/link"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import { getSessionContext } from "@/lib/authz"

export const dynamic = "force-dynamic"

type Tab = "all" | "curated" | "drafts"

export default async function ScriptsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const sp = await searchParams
  const tab: Tab = sp.tab === "curated" || sp.tab === "drafts" ? sp.tab : "all"

  const ctx = await getSessionContext()
  const isAdmin = ctx?.role === "ADMIN"

  const where =
    tab === "curated"
      ? { isActive: true, isCurated: true }
      : tab === "drafts"
      ? { isActive: true, isCurated: false }
      : { isActive: true }

  const [rows, counts] = await Promise.all([
    prisma.fl_Script.findMany({
      where,
      orderBy: [{ isCurated: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.fl_Script.groupBy({
      by: ["isCurated"],
      where: { isActive: true },
      _count: true,
    }),
  ])

  const curatedCount = counts.find((c) => c.isCurated)?._count ?? 0
  const draftCount = counts.find((c) => !c.isCurated)?._count ?? 0
  const totalCount = curatedCount + draftCount

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Scripts
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
              Curated library — quality over quantity. Each save signs the body; the agent verifies before run.
            </p>
          </div>
          {isAdmin && (
            <Link href="/scripts/new" style={primaryButtonStyle}>
              + New script
            </Link>
          )}
        </header>

        <nav style={{ display: "flex", gap: "4px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
          <TabLink label={`All · ${totalCount}`} href="/scripts" active={tab === "all"} />
          <TabLink label={`Curated · ${curatedCount}`} href="/scripts?tab=curated" active={tab === "curated"} />
          <TabLink label={`Drafts · ${draftCount}`} href="/scripts?tab=drafts" active={tab === "drafts"} />
        </nav>

        {rows.length === 0 ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "10px",
              color: "var(--color-text-muted)",
              fontSize: "13px",
            }}
          >
            {tab === "all"
              ? "No scripts yet. Add your first one to start the library."
              : `No scripts in this view.`}
          </div>
        ) : (
          <section
            style={{
              background: "var(--color-background-secondary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ color: "var(--color-text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Shell</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Signed by</th>
                  <th style={thStyle}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={tdStyle}>
                      <Link href={`/scripts/${r.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                        {r.name}
                      </Link>
                      {r.description && (
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}><code style={codeStyle}>{r.shell}</code></td>
                    <td style={tdStyle}>{r.category ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}</td>
                    <td style={tdStyle}>
                      <span style={r.isCurated ? curatedPillStyle : draftPillStyle}>
                        {r.isCurated ? "curated" : "draft"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontSize: "12px" }}>{r.signedBy ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}</div>
                      {r.signedAt && (
                        <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
                          {r.signedAt.toISOString().slice(0, 10)}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>{r.updatedAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </AppShell>
  )
}

function TabLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        padding: "8px 14px",
        fontSize: "12px",
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        fontWeight: active ? 600 : 400,
        borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
        marginBottom: "-0.5px",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  )
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "7px 14px",
  background: "var(--color-accent)",
  color: "white",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 500,
  textDecoration: "none",
  whiteSpace: "nowrap",
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 16px",
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: "10px 16px",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
}

const codeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "11px",
  padding: "1px 6px",
  background: "var(--color-background-tertiary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "4px",
  color: "var(--color-text-secondary)",
}

const curatedPillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 500,
  background: "var(--color-success-soft, rgba(34, 197, 94, 0.15))",
  color: "var(--color-success)",
}

const draftPillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 500,
  background: "var(--color-background-tertiary)",
  color: "var(--color-text-muted)",
}
