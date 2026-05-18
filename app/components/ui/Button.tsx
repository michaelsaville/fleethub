import type { ButtonHTMLAttributes, CSSProperties } from "react"

// Phase 8 Workstream C — canonical Button. Four variants, two
// sizes. Single source of truth for the button shape across the
// app; replaces the 5 inline geometries the UI audit found.
//
// Canonical shape (from PHASE-8-DESIGN §5.1): "8px 14px" padding,
// radius 6 (sm) / 8 (md aliased to sm here), fontWeight 600. No
// border on primary; 0.5px border on secondary/ghost.

type Variant = "primary" | "secondary" | "danger" | "ghost"
type Size = "xs" | "sm" | "md"

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: Variant
  size?: Size
}

// Phase 11 WS-E.2 — `xs` is the icon-button / inline-action size.
// Closes the NotesCard / MfaChallengeForm hand-rolled iconBtn debt
// the Phase-10 audit flagged.
const SIZE: Record<Size, CSSProperties> = {
  xs: { padding: "1px 6px", fontSize: "10.5px" },
  sm: { padding: "6px 12px", fontSize: "12px" },
  md: { padding: "8px 14px", fontSize: "13px" },
}

function variantStyle(variant: Variant, disabled: boolean): CSSProperties {
  if (disabled) {
    return {
      background: "var(--color-background-tertiary)",
      color: "var(--color-text-muted)",
      border: "0.5px solid var(--color-border-tertiary)",
      cursor: "not-allowed",
    }
  }
  switch (variant) {
    case "primary":
      return {
        background: "var(--color-accent)",
        color: "#fff",
        border: "none",
      }
    case "danger":
      return {
        background: "var(--color-danger)",
        color: "#fff",
        border: "none",
      }
    case "secondary":
      return {
        background: "var(--color-background-secondary)",
        color: "var(--color-text-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
      }
    case "ghost":
      return {
        background: "transparent",
        color: "var(--color-text-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
      }
  }
}

export function Button({
  variant = "primary",
  size = "md",
  style,
  disabled,
  ...rest
}: Props) {
  const composed: CSSProperties = {
    ...SIZE[size],
    ...variantStyle(variant, !!disabled),
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    transition: "background 120ms ease, opacity 120ms ease",
    ...style,
  }
  return <button {...rest} disabled={disabled} style={composed} />
}

/** Convenience for use as a `<Link>` styled like a button. The
 *  consumer wraps an anchor / Next Link around this — the
 *  component just emits the style object. */
export function buttonStyle({
  variant = "primary",
  size = "md",
  disabled = false,
}: {
  variant?: Variant
  size?: Size
  disabled?: boolean
} = {}): CSSProperties {
  return {
    ...SIZE[size],
    ...variantStyle(variant, disabled),
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    textDecoration: "none",
    display: "inline-block",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
  }
}
