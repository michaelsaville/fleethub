import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import { getSessionContext } from "@/lib/authz"
import { updateScript, toggleScriptActive } from "../actions"
import { ScriptForm } from "../ScriptForm"

export const dynamic = "force-dynamic"

export default async function ScriptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await getSessionContext()
  const isAdmin = ctx?.role === "ADMIN"

  const script = await prisma.fl_Script.findUnique({ where: { id } })
  if (!script) notFound()

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "800px" }}>
        <header>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            <Link href="/scripts" style={{ color: "inherit", textDecoration: "none" }}>← Scripts</Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              {script.name}
            </h1>
            <span style={script.isCurated ? curatedPillStyle : draftPillStyle}>
              {script.isCurated ? "curated" : "draft"}
            </span>
            {!script.isActive && <span style={inactivePillStyle}>inactive</span>}
          </div>
          {script.description && (
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
              {script.description}
            </p>
          )}
        </header>

        <section style={metaCardStyle}>
          <MetaRow label="Signed by" value={script.signedBy ?? "—"} />
          <MetaRow label="Signed at" value={script.signedAt?.toISOString().replace("T", " ").slice(0, 19) ?? "—"} />
          <MetaRow label="Hash" value={<code style={hashStyle}>{script.signedHash}</code>} />
          <MetaRow label="Updated" value={script.updatedAt.toISOString().replace("T", " ").slice(0, 19)} />
        </section>

        <ScriptForm
          action={updateScript}
          submitLabel={isAdmin ? "Save &amp; re-sign" : "Read-only"}
          script={script}
          readOnly={!isAdmin}
        />

        {isAdmin && (
          <form action={toggleScriptActive}>
            <input type="hidden" name="id" value={script.id} />
            <button type="submit" style={dangerButtonStyle}>
              {script.isActive ? "Deactivate script" : "Reactivate script"}
            </button>
          </form>
        )}
      </div>
    </AppShell>
  )
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", padding: "6px 0", fontSize: "12px", gap: "12px" }}>
      <div style={{ width: "100px", color: "var(--color-text-muted)", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.06em", fontWeight: 600, paddingTop: "2px" }}>
        {label}
      </div>
      <div style={{ flex: 1, color: "var(--color-text-primary)", minWidth: 0, wordBreak: "break-all" }}>
        {value}
      </div>
    </div>
  )
}

const metaCardStyle: React.CSSProperties = {
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "10px",
  padding: "12px 16px",
}

const hashStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "11px",
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

const inactivePillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 500,
  background: "var(--color-danger-soft, rgba(239, 68, 68, 0.15))",
  color: "var(--color-danger)",
}

const dangerButtonStyle: React.CSSProperties = {
  padding: "7px 14px",
  background: "transparent",
  color: "var(--color-danger)",
  border: "0.5px solid var(--color-danger)",
  borderRadius: "6px",
  fontSize: "13px",
  cursor: "pointer",
}
