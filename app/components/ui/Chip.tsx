import type { CSSProperties, ReactNode, MouseEventHandler } from "react"
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
//
// Phase 11 WS-E.2: `interactive` + `active` modes for filter-chip
// rows (audit-page QuickRangePresets is the lead caller). When
// `interactive`, the chip renders as a button-like span with
// pointer cursor + onClick prop. `active` flips the variant to
// solid for the chosen item in a row.

type Variant = "soft" | "solid"

interface Props {
  tone: Tone
  variant?: Variant
  interactive?: boolean
  active?: boolean
  href?: string
  onClick?: MouseEventHandler<HTMLElement>
  children: ReactNode
  style?: CSSProperties
  title?: string
}

export function Chip({
  tone,
  variant = "soft",
  interactive = false,
  active = false,
  href,
  onClick,
  title,
  children,
  style,
}: Props) {
  const t = TONE[tone]
  const effectiveVariant: Variant = active ? "solid" : variant
  const composed: CSSProperties = {
    display: "inline-block",
    padding: "1px 8px",
    fontSize: "10px",
    fontWeight: 600,
    borderRadius: "var(--radius-full)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    whiteSpace: "nowrap",
    ...(effectiveVariant === "solid"
      ? { background: t.color, color: "#fff" }
      : { background: t.bg, color: t.color }),
    ...(interactive
      ? {
          cursor: "pointer",
          userSelect: "none",
          textDecoration: "none",
        }
      : {}),
    ...style,
  }
  if (href) {
    return (
      <a href={href} style={composed} title={title} onClick={onClick}>
        {children}
      </a>
    )
  }
  if (interactive) {
    return (
      <span
        role="button"
        tabIndex={0}
        style={composed}
        title={title}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            // Click handler treats the span as a button.
            ;(e.currentTarget as HTMLElement).click()
          }
        }}
      >
        {children}
      </span>
    )
  }
  return <span style={composed} title={title}>{children}</span>
}
