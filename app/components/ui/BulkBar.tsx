"use client"
import { useEffect } from "react"
import type { CSSProperties, ReactNode } from "react"

// Phase 12 WS-D.2 — canonical sticky-bottom bulk-action bar.
//
// Replaces hand-rolled bars in DeviceTable (line 297) + AlertsTable
// (line 351). Same shape, same accent border, same z-index. The
// `variant="undo"` mode is the bulk-ack undo toast (5s auto-clear)
// from WS-D.6.

interface Props {
  count: number
  /** Optional summary like "12 devices selected · 3 prod tagged" */
  summary?: ReactNode
  /** Action buttons; rendered right-aligned. */
  actions: ReactNode
  /** Called by the X close button. */
  onClear: () => void
  /** Phase 12 WS-D.6 — toast variant: auto-clears after `autoClearMs`. */
  variant?: "default" | "undo"
  autoClearMs?: number
  style?: CSSProperties
}

export function BulkBar({
  count,
  summary,
  actions,
  onClear,
  variant = "default",
  autoClearMs,
  style,
}: Props) {
  useEffect(() => {
    if (variant !== "undo" || !autoClearMs) return
    const t = setTimeout(onClear, autoClearMs)
    return () => clearTimeout(t)
  }, [variant, autoClearMs, onClear])

  const accent = variant === "undo" ? "var(--color-success)" : "var(--color-accent)"

  return (
    <div
      style={{
        position: "sticky",
        bottom: 12,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "var(--color-background-tertiary)",
        border: "0.5px solid var(--color-border-secondary)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        ...style,
      }}
      role="region"
      aria-label="Bulk actions"
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>
        {count} {count === 1 ? "item" : "items"}
        {summary && (
          <span style={{ color: "var(--color-text-muted)", fontWeight: 400, marginLeft: 8 }}>
            {summary}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
        {actions}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          style={{
            background: "transparent",
            border: 0,
            color: "var(--color-text-muted)",
            fontSize: 18,
            padding: "0 4px",
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
