import Link from "next/link"
import AppShell from "@/components/AppShell"
import { listAuditEvents } from "@/lib/audit-events"
import type { AuditEventRow } from "@/lib/audit-events"
import { requireSession } from "@/lib/authz"
import VerifyChainButton from "./VerifyChainButton"

export const dynamic = "force-dynamic"

/**
 * ADMIN-only audit log viewer. The hash-chain is verified by
 * /api/audit/verify; this page is for human investigation. Filters are
 * URL-state so techs can share a permalink to a specific search.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    actor?: string
    action?: string
    outcome?: string
    client?: string
    device?: string
    from?: string
    to?: string
    page?: string
  }>
}) {
  const ctx = await requireSession()
  const sp = await searchParams

  if (ctx.role !== "ADMIN") {
    return (
      <AppShell>
        <div style={{ padding: "32px", maxWidth: "560px", margin: "0 auto", textAlign: "center" }}>
          <h1 style={{ fontSize: "18px", fontWeight: 600, margin: 0, marginBottom: "8px" }}>Audit log</h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
            The audit log is restricted to ADMIN role. Per HIPAA-READY.md the
            log itself records every read of PHI-adjacent data, and we keep
            the read surface narrow.
          </p>
        </div>
      </AppShell>
    )
  }

  const filters = {
    actorEmail: sp.actor,
    action: sp.action,
    outcome: (sp.outcome ?? "all") as "ok" | "error" | "pending" | "all",
    clientName: sp.client,
    deviceId: sp.device,
    fromIso: sp.from || undefined,
    toIso:   sp.to   || undefined,
  }
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const result = await listAuditEvents(filters, page)

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              Audit log
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: "640px" }}>
              Append-only, hash-chained record of every privileged action.
              Filter by actor, action prefix, outcome, or date range; the
              chain itself is checked by the verify button at right.
            </p>
          </div>
          <VerifyChainButton />
        </header>

        <FilterBar
          filters={filters}
          actors={result.facets.actors}
          actions={result.facets.actions}
        />

        <Card title={`Events · ${result.total.toLocaleString()}`}>
          {result.rows.length === 0 ? (
            <Empty>No events match these filters.</Empty>
          ) : (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr style={thHeadRow}>
                    <th style={thStyle}>When</th>
                    <th style={thStyle}>Actor</th>
                    <th style={thStyle}>Action</th>
                    <th style={thStyle}>Outcome</th>
                    <th style={thStyle}>Target</th>
                    <th style={thStyle}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => <AuditRow key={r.id} row={r} />)}
                </tbody>
              </table>
              <Pager page={result.page} pageCount={result.pageCount} sp={sp} />
            </>
          )}
        </Card>
      </div>
    </AppShell>
  )
}

function FilterBar({
  filters,
  actors,
  actions,
}: {
  filters: { actorEmail?: string; action?: string; outcome?: string; clientName?: string; deviceId?: string; fromIso?: string; toIso?: string }
  actors: string[]
  actions: string[]
}) {
  return (
    <form
      method="get"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "8px",
        padding: "12px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
      }}
    >
      <Field label="Actor">
        <input
          name="actor"
          type="text"
          list="audit-actors"
          defaultValue={filters.actorEmail ?? ""}
          placeholder="user@…"
          style={inputStyle}
        />
        <datalist id="audit-actors">
          {actors.map((a) => <option key={a} value={a} />)}
        </datalist>
      </Field>
      <Field label="Action">
        <input
          name="action"
          type="text"
          list="audit-actions"
          defaultValue={filters.action ?? ""}
          placeholder="e.g. agent. or auth.signin"
          style={inputStyle}
        />
        <datalist id="audit-actions">
          {actions.map((a) => <option key={a} value={a} />)}
        </datalist>
      </Field>
      <Field label="Outcome">
        <select name="outcome" defaultValue={filters.outcome ?? "all"} style={inputStyle}>
          <option value="all">All</option>
          <option value="ok">ok</option>
          <option value="error">error</option>
          <option value="pending">pending</option>
        </select>
      </Field>
      <Field label="Client">
        <input name="client" type="text" defaultValue={filters.clientName ?? ""} placeholder="TH_Client.name" style={inputStyle} />
      </Field>
      <Field label="Device ID">
        <input name="device" type="text" defaultValue={filters.deviceId ?? ""} placeholder="Fl_Device.id" style={inputStyle} />
      </Field>
      <Field label="From">
        <input name="from" type="datetime-local" defaultValue={toLocalInput(filters.fromIso)} style={inputStyle} />
      </Field>
      <Field label="To">
        <input name="to" type="datetime-local" defaultValue={toLocalInput(filters.toIso)} style={inputStyle} />
      </Field>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
        <button type="submit" style={btnPrimary}>Apply</button>
        <Link href="/audit" style={{ ...btnSecondary, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
          Reset
        </Link>
      </div>
    </form>
  )
}

function toLocalInput(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      <span style={{ fontSize: "10.5px", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function AuditRow({ row }: { row: AuditEventRow }) {
  const tone =
    row.outcome === "ok"      ? "var(--color-success)" :
    row.outcome === "error"   ? "var(--color-danger)" :
                                "var(--color-warning)"
  return (
    <tr style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
      <td style={tdStyle}>
        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "10.5px", color: "var(--color-text-secondary)" }}>
          {row.createdAt.toISOString().replace("T", " ").slice(0, 19)}
        </span>
      </td>
      <td style={tdStyle}>
        <span style={{ fontSize: "11.5px", color: row.actorEmail ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
          {row.actorEmail ?? "system"}
        </span>
      </td>
      <td style={tdStyle}>
        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px", color: "var(--color-text-primary)" }}>
          {row.action}
        </code>
      </td>
      <td style={tdStyle}>
        <span
          style={{
            fontSize: "10px",
            padding: "1px 7px",
            borderRadius: "999px",
            background: "var(--color-background-tertiary)",
            color: tone,
            border: `0.5px solid ${tone}`,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          {row.outcome}
        </span>
      </td>
      <td style={tdStyle}>
        {row.deviceId && row.deviceHostname ? (
          <Link
            href={`/devices/${row.deviceId}`}
            style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px" }}
          >
            {row.deviceHostname}
          </Link>
        ) : row.clientName ? (
          <Link
            href={`/clients/${encodeURIComponent(row.clientName)}`}
            style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontSize: "11px" }}
          >
            {row.clientName}
          </Link>
        ) : (
          <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>—</span>
        )}
      </td>
      <td style={{ ...tdStyle, maxWidth: "440px" }}>
        <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.45, wordBreak: "break-word", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.detail ?? <span style={{ color: "var(--color-text-muted)" }}>—</span>}
        </div>
      </td>
    </tr>
  )
}

function Pager({
  page,
  pageCount,
  sp,
}: {
  page: number
  pageCount: number
  sp: Record<string, string | undefined>
}) {
  if (pageCount <= 1) return null
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page") continue
    if (v) params.set(k, v)
  }
  const link = (n: number) => {
    const p = new URLSearchParams(params)
    p.set("page", String(n))
    return `/audit?${p.toString()}`
  }
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", fontSize: "11.5px", color: "var(--color-text-muted)" }}>
      <span>
        Page {page} of {pageCount}
      </span>
      <div style={{ display: "flex", gap: "6px" }}>
        {page > 1 && (
          <Link href={link(page - 1)} style={{ ...btnSecondary, textDecoration: "none", display: "inline-flex" }}>‹ Prev</Link>
        )}
        {page < pageCount && (
          <Link href={link(page + 1)} style={{ ...btnSecondary, textDecoration: "none", display: "inline-flex" }}>Next ›</Link>
        )}
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "14px" }}>{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)", lineHeight: 1.55 }}>{children}</div>
}

const inputStyle: React.CSSProperties = {
  fontSize: "12px",
  padding: "5px 8px",
  background: "var(--color-background-tertiary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "6px",
  color: "var(--color-text-primary)",
}

const btnPrimary: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 500,
  padding: "6px 14px",
  borderRadius: "6px",
  border: "0.5px solid var(--color-accent)",
  background: "var(--color-accent)",
  color: "white",
  cursor: "pointer",
}

const btnSecondary: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 500,
  padding: "5px 12px",
  borderRadius: "6px",
  border: "0.5px solid var(--color-border-tertiary)",
  background: "transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
}

const thHeadRow: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "10.5px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
}
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontWeight: 600,
}
const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
}
