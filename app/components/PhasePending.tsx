import AppShell from "@/components/AppShell"

/**
 * Phase-pending placeholder page. Used for sidebar destinations where
 * the section is planned but not yet built, so the sidebar nav doesn't
 * 404 in Phase 0.
 */
export default function PhasePending({
  title,
  phaseLabel,
  description,
}: {
  title: string
  phaseLabel: string
  description: string
}) {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "640px" }}>
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>{title}</h1>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 500,
                padding: "2px 10px",
                borderRadius: "999px",
                background: "var(--color-background-tertiary)",
                color: "var(--color-text-muted)",
                border: "0.5px solid var(--color-border-tertiary)",
              }}
            >
              {phaseLabel}
            </span>
          </div>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            {description}
          </p>
        </header>
        <div
          style={{
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "10px",
            padding: "20px",
            color: "var(--color-text-muted)",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
        >
          Section is scaffolded but unbuilt. The Phase 0 deploy proves
          end-to-end auth + DB + nginx + cert work; meaningful content
          arrives once the prerequisite phase ships.
        </div>
      </div>
    </AppShell>
  )
}
