import type { CSSProperties } from "react"

// Phase 9 WS-E §7.3 — shimmer skeleton primitives. CSS-animated;
// no JS. Used by app/(protected)/loading.tsx and any per-segment
// loading overrides.
//
// The shimmer is driven by globals.css @keyframes fl-shimmer
// (added in the same WS-E commit). Falls back to a static muted
// background if the keyframe isn't present.

interface BarProps {
  width?: string | number
  height?: string | number
  style?: CSSProperties
}

export function SkeletonBar({ width = "60%", height = 14, style }: BarProps) {
  return (
    <div
      aria-hidden
      style={{
        width,
        height,
        borderRadius: 6,
        background:
          "linear-gradient(90deg, var(--color-background-tertiary) 0%, var(--color-background-secondary) 50%, var(--color-background-tertiary) 100%)",
        backgroundSize: "200% 100%",
        animation: "fl-shimmer 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  )
}

interface CardProps {
  rows?: number
  style?: CSSProperties
}

export function SkeletonCard({ rows = 3, style }: CardProps) {
  return (
    <div
      aria-hidden
      style={{
        padding: "14px 16px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
    >
      <SkeletonBar width="35%" height={11} />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBar key={i} width={i === rows - 1 ? "75%" : "100%"} height={13} />
      ))}
    </div>
  )
}
