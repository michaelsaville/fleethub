import type { CSSProperties, ReactNode } from "react"
import { CARD, CARD_HEADER, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 8 Workstream C — canonical card chrome. Replaces the
// radius-8-vs-radius-10 drift the UI audit found, plus the
// header-style variation.
//
// Use <Card> as a section wrapper. Use <Card><CardHeader title=
// "Foo" />…body…</Card> for the header pattern, or pass a custom
// header via the `header` prop on Card directly.

interface CardProps {
  children: ReactNode
  style?: CSSProperties
  padding?: number | string
}

export function Card({ children, style, padding = "14px 16px" }: CardProps) {
  return (
    <section style={{ ...CARD, padding, ...style }}>
      {children}
    </section>
  )
}

interface CardHeaderProps {
  title: ReactNode
  /** Optional right-aligned content — typically an action button. */
  action?: ReactNode
  /** Caps-label styling for the title vs regular h2. Default true
   *  (matches the existing FleetHub pattern). */
  caps?: boolean
  style?: CSSProperties
}

export function CardHeader({ title, action, caps = true, style }: CardHeaderProps) {
  return (
    <header style={{ ...CARD_HEADER, padding: 0, marginBottom: 12, ...style }}>
      <h2 style={caps ? TYPOGRAPHY.LABEL_CAPS : TYPOGRAPHY.H2}>
        {title}
      </h2>
      {action ?? null}
    </header>
  )
}
