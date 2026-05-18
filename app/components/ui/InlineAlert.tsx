import type { CSSProperties, ReactNode } from "react"
import { TONE } from "@/lib/ui-tokens"

// Phase 9 WS-E §7.4 — canonical inline-alert chrome. Replaces the
// four hand-rolled error/warning banners in AlertRouteForm,
// OncallScheduleForm, RunbookForm, RemoteSessionLauncher. Pure
// presentation — no dismiss, no animation; this is the inline
// form-error / inline-warning pattern, not a global toast.

interface Props {
  tone: "danger" | "warn" | "info" | "ok"
  children: ReactNode
  style?: CSSProperties
}

export function InlineAlert({ tone, children, style }: Props) {
  const palette = tone === "danger" ? TONE.bad : tone === "warn" ? TONE.warn : tone === "info" ? TONE.accent : TONE.ok
  return (
    <div
      role="alert"
      style={{
        padding: "8px 10px",
        fontSize: 12,
        color: palette.color,
        background: palette.bg,
        borderRadius: 6,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
