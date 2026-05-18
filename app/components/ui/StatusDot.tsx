import type { CSSProperties } from "react"

// Phase 12 WS-A.6 — status indicator dot primitive.
//
// Hand-rolled 7px online/offline dot was inlined in DeviceTable +
// clients/[name] and was about to land a third copy in
// /network-devices. Extracted before the third copy per architect §1.
//
// Tones map to the TONE_PALETTE: ok = green, muted = grey-text,
// warn = amber, danger = red. `dot-only` is the default;
// pass `label` for screen-readers + tooltip.

export type StatusDotTone = "ok" | "muted" | "warn" | "danger"

interface Props {
  tone: StatusDotTone
  /** Pixel size (default 7). */
  size?: number
  /** Aria label + native title. */
  label?: string
  style?: CSSProperties
}

const COLOR: Record<StatusDotTone, string> = {
  ok: "var(--color-success)",
  muted: "var(--color-text-muted)",
  warn: "var(--color-warning)",
  danger: "var(--color-danger)",
}

export function StatusDot({ tone, size = 7, label, style }: Props) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      title={label}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "999px",
        background: COLOR[tone],
        verticalAlign: "middle",
        flexShrink: 0,
        ...style,
      }}
    />
  )
}
