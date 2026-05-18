import Link from "next/link"

/**
 * Hyperlinked KPI card — per UI-PATTERNS.md ("Hyperlink every dashboard
 * number"). Every metric on the dashboard goes through this component
 * so we can never accidentally render a static number.
 *
 * `tone` colorizes the number; `delta` shows trend (use null to hide).
 */
interface StatCardProps {
  label: string
  value: string | number
  href: string
  tone?: "neutral" | "ok" | "warn" | "danger"
  delta?: { dir: "up" | "down" | "flat"; text: string } | null
  hint?: string
  /// Phase 11 WS-E.2 — "lg" (default) is the 28px dashboard headline
  /// shape; "sm" is the 18px drill-down shape that previously lived
  /// as 4 hand-rolled Tile widgets (software / clients/[name] /
  /// reports / patches). Closes the Phase-10-deferred Tile clone debt.
  size?: "sm" | "lg"
}

export default function StatCard({
  label,
  value,
  href,
  tone = "neutral",
  delta,
  hint,
  size = "lg",
}: StatCardProps) {
  const valueColor = {
    neutral: "var(--color-text-primary)",
    ok: "var(--color-success)",
    warn: "var(--color-warning)",
    danger: "var(--color-danger)",
  }[tone]

  const isLg = size === "lg"
  const valueFontSize = isLg ? "28px" : "18px"
  const cardPadding = isLg ? "16px 18px" : "10px 12px"
  const labelMargin = isLg ? "8px" : "4px"

  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: cardPadding,
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
        textDecoration: "none",
        color: "var(--color-text-primary)",
        transition: "border-color 0.12s, background 0.12s",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: labelMargin,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
        <div style={{ fontSize: valueFontSize, fontWeight: 600, letterSpacing: "-0.02em", color: valueColor }}>
          {value}
        </div>
        {delta && (
          <div
            style={{
              fontSize: "11px",
              color: delta.dir === "up" ? "var(--color-success)" : delta.dir === "down" ? "var(--color-danger)" : "var(--color-text-muted)",
            }}
          >
            {delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "—"} {delta.text}
          </div>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "6px" }}>
          {hint}
        </div>
      )}
    </Link>
  )
}
