import type { ReactNode } from "react"

// Phase 8 Workstream C — canonical empty-state. Replaces the 5
// rolled-inline variants the UI audit found (40px vs 30px padding,
// solid vs dashed borders, hex literals).
//
// Spec: solid 0.5px border, radius 10, 40px padding, centered
// muted text. Optional action slot at the bottom.

interface Props {
  /** Optional headline. When provided, renders bold above the body. */
  title?: ReactNode
  /** Main body content. Can be a single sentence or short JSX. */
  body: ReactNode
  /** Optional action — typically a Button or Link. */
  action?: ReactNode
}

export function EmptyState({ title, body, action }: Props) {
  return (
    <div
      style={{
        padding: "40px",
        textAlign: "center",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--radius-md)",
        color: "var(--color-text-muted)",
        fontSize: "13px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      {title && (
        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {title}
        </div>
      )}
      <div>{body}</div>
      {action && <div>{action}</div>}
    </div>
  )
}
