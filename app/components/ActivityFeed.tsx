/**
 * Reusable activity feed — per UI-PATTERNS.md "first-class component on
 * every detail page." Same component on Device detail, Client detail,
 * Dashboard, etc. — populated from Fl_AuditLog.
 *
 * Phase 0 takes mock data via prop. Phase 1 swaps for a server-component
 * variant that queries Fl_AuditLog with the right filters.
 */
export interface ActivityItem {
  id: string
  ts: string  // ISO or pre-formatted "2m ago"
  actor?: string | null
  action: string
  outcome: "ok" | "error" | "pending"
  detail?: string
}

export default function ActivityFeed({ items, title = "Recent activity" }: { items: ActivityItem[]; title?: string }) {
  return (
    <div
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
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
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.length === 0 ? (
          <li style={{ padding: "16px", color: "var(--color-text-muted)", fontSize: "12px" }}>
            No activity yet.
          </li>
        ) : (
          items.map((it, i) => (
            <li
              key={it.id}
              style={{
                display: "flex",
                gap: "12px",
                padding: "10px 16px",
                borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)",
                fontSize: "12px",
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  marginTop: "5px",
                  flexShrink: 0,
                  background:
                    it.outcome === "ok"
                      ? "var(--color-success)"
                      : it.outcome === "error"
                      ? "var(--color-danger)"
                      : "var(--color-warning)",
                }}
              />
              <span style={{ width: "70px", color: "var(--color-text-muted)", flexShrink: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px" }}>
                {it.ts}
              </span>
              <span style={{ flex: 1, color: "var(--color-text-primary)" }}>
                <span style={{ fontWeight: 500 }}>{it.action}</span>
                {it.detail && <span style={{ color: "var(--color-text-muted)" }}> · {it.detail}</span>}
                {it.actor && (
                  <span style={{ color: "var(--color-text-muted)" }}> · {it.actor}</span>
                )}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
