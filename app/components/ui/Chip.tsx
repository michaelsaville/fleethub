import type { CSSProperties, ReactNode } from "react"
import { TONE, type Tone } from "@/lib/ui-tokens"

// Phase 8 Workstream C — canonical state chip. Replaces three
// competing pill shapes the UI audit found (radius 999 vs 3,
// soft vs solid, hex literals vs CSS vars). Single primitive
// with two variants.
//
// `soft` (default): tinted bg + colored text. The "you're fine
// or in light trouble" feel.
// `solid`: full-bleed bg + white text. The "this is a KEV /
// critical / hard-stop" feel.

type Variant = "soft" | "solid"

interface Props {
  tone: Tone
  variant?: Variant
  children: ReactNode
  style?: CSSProperties
}

export function Chip({ tone, variant = "soft", children, style }: Props) {
  const t = TONE[tone]
  const composed: CSSProperties = {
    display: "inline-block",
    padding: "1px 8px",
    fontSize: "10px",
    fontWeight: 600,
    borderRadius: "var(--radius-full)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    whiteSpace: "nowrap",
    ...(variant === "solid"
      ? { background: t.color, color: "#fff" }
      : { background: t.bg, color: t.color }),
    ...style,
  }
  return <span style={composed}>{children}</span>
}
