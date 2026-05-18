import type { CSSProperties } from "react"
import { TONE, type Tone } from "@/lib/ui-tokens"

// Phase 11 WS-E.1 — sidebar / nav notification dot.
// count=0 → 6px dot (or nothing if `showZero=false`).
// count>0 → numeric bubble.
// count>max → "N+" with default max=99.

interface Props {
  count: number
  max?: number
  tone?: Tone
  /// When false (default), count=0 renders nothing — no dot at all.
  showZero?: boolean
  style?: CSSProperties
  /// When set, renders a 6px dot regardless of count (uses tone).
  /// Useful for "has pending events without exact count".
  dotOnly?: boolean
}

export function NotificationBadge({
  count,
  max = 99,
  tone = "warn",
  showZero = false,
  dotOnly = false,
  style,
}: Props) {
  const t = TONE[tone]
  if (dotOnly) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          background: t.color,
          borderRadius: "var(--radius-full)",
          ...style,
        }}
      />
    )
  }
  if (count <= 0 && !showZero) return null
  const text = count > max ? `${max}+` : String(count)
  return (
    <span
      aria-label={`${count} pending`}
      style={{
        display: "inline-block",
        minWidth: 16,
        height: 16,
        padding: "0 5px",
        background: t.color,
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: "16px",
        textAlign: "center",
        borderRadius: "var(--radius-full)",
        ...style,
      }}
    >
      {text}
    </span>
  )
}
