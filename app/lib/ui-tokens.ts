import type { CSSProperties } from "react"

// Phase 8 Workstream C step 1 — design-system tokens.
//
// Codifies the values the UI audit found scattered across pages:
//   5 button geometries → one canonical Phase-7 shape
//   8 font sizes        → 5 typography sizes locked
//   FIELD_STYLE         → declared 5x identically across forms,
//                         now lives here once
//   chip variants       → soft (default) vs solid; one component
//
// These are React.CSSProperties so existing inline-style pages
// can import + spread without a framework swap. New pages should
// import the components from app/components/ui/ which wrap these.
//
// The voice (per PHASE-8-DESIGN §14): NO new hex literals, no
// new font-size values, no new radius values that don't reference
// these tokens.

export const TYPOGRAPHY = {
  /** Page H1 — 20px / 600 / letter-spacing tight. */
  H1: {
    fontSize: "20px",
    fontWeight: 600,
    margin: 0,
    letterSpacing: "-0.01em",
  } satisfies CSSProperties,

  /** Section H2 — 14px / 600. */
  H2: {
    fontSize: "14px",
    fontWeight: 600,
    margin: 0,
    letterSpacing: "-0.01em",
  } satisfies CSSProperties,

  /** Body — 13px primary text size. */
  BODY: {
    fontSize: "13px",
    color: "var(--color-text-primary)",
  } satisfies CSSProperties,

  /** Body muted — 13px secondary. Header subtitles, hints. */
  BODY_MUTED: {
    fontSize: "13px",
    color: "var(--color-text-secondary)",
  } satisfies CSSProperties,

  /** Hint text under fields — 11px muted. */
  HINT: {
    fontSize: "11px",
    color: "var(--color-text-muted)",
  } satisfies CSSProperties,

  /** Caps label — uppercase 11/600/letter-spaced-wide. Section
   *  headers, field labels, table column headers. */
  LABEL_CAPS: {
    fontSize: "11px",
    fontWeight: 600,
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  } satisfies CSSProperties,
} as const

export const RADIUS = {
  sm: "var(--radius-sm)",   // 6px — buttons, inputs
  md: "var(--radius-md)",   // 10px — cards, panels
  full: "var(--radius-full)", // 9999px — chips, badges
} as const

/** Canonical form-input style. Spread into your <input> /
 *  <select> / <textarea>. The shared <Field> component already
 *  wraps this. */
export const FIELD: CSSProperties = {
  padding: "7px 10px",
  fontSize: "13px",
  background: "var(--color-background-primary)",
  color: "var(--color-text-primary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "var(--radius-sm)",
  outline: "none",
  fontFamily: "inherit",
}

/** Tighter form-input variant for dense rows where many small
 *  inputs live side-by-side (e.g. oncall rotation slots: user +
 *  day + start + end on one line). Same colors as FIELD, just
 *  tighter padding. */
export const FIELD_SM: CSSProperties = {
  ...FIELD,
  padding: "6px 9px",
}

/** Canonical table column header (<th>). */
export const TH: CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: "10.5px",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  whiteSpace: "nowrap",
}

/** Canonical table body cell (<td>). Body font is 12.5 across
 *  table-style lists (msp triage, runbook list, etc.). */
export const TD: CSSProperties = {
  padding: "8px 12px",
  fontSize: "12.5px",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
}

/** Section / panel card. Spread into a <div> or use the <Card>
 *  component which wraps this + optional <CardHeader>. */
export const CARD: CSSProperties = {
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: "var(--radius-md)",
}

/** Top of a card with a caps header. */
export const CARD_HEADER: CSSProperties = {
  padding: "14px 16px 0",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
}

/** Tone tokens — semantic colors that map to CSS variables.
 *  Use ToneColor / ToneBg via the Chip / Button components
 *  rather than referencing these directly. */
export const TONE = {
  neutral: {
    color: "var(--color-text-secondary)",
    bg: "var(--color-background-tertiary)",
  },
  ok: {
    color: "var(--color-success)",
    bg: "var(--color-success-soft)",
  },
  warn: {
    color: "var(--color-warning)",
    bg: "var(--color-warning-soft)",
  },
  bad: {
    color: "var(--color-danger)",
    bg: "var(--color-danger-soft)",
  },
  kev: {
    color: "var(--color-kev)",
    bg: "var(--color-kev-soft)",
  },
  accent: {
    color: "var(--color-accent)",
    bg: "var(--color-accent-soft)",
  },
} as const

export type Tone = keyof typeof TONE
