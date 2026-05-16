"use client"
import type { CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, SelectHTMLAttributes } from "react"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 8 Workstream C — canonical form field. Wraps a label +
// input + hint. Replaces the FIELD_STYLE constant that was
// declared identically in 5 different form files (AlertRouteForm,
// OncallScheduleForm, RunbookForm, ScriptForm, audit page).
//
// Use:
//   <Field label="Name" hint="...">
//     <input value={...} onChange={...} />
//   </Field>
//
// Or use the convenience inputs that auto-apply the FIELD style:
//   <Field label="Name"><FieldInput value={...} onChange={...} /></Field>

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  /** Marks the label with an asterisk + danger color. */
  required?: boolean
  /** Inline error text rendered below the input, replacing the hint. */
  error?: string | null
  children: ReactNode
  /** Override the row gap. */
  gap?: number
}

export function Field({ label, hint, required, error, children, gap = 4 }: FieldProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap, fontSize: "12.5px" }}>
      {label && (
        <span style={{ ...TYPOGRAPHY.LABEL_CAPS }}>
          {label}
          {required && <span style={{ color: "var(--color-danger)", marginLeft: 4 }}>*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span style={{ fontSize: "11px", color: "var(--color-danger)" }}>{error}</span>
      ) : hint ? (
        <span style={TYPOGRAPHY.HINT}>{hint}</span>
      ) : null}
    </label>
  )
}

/** Auto-styled <input> for the common case. */
export function FieldInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...FIELD, ...(props.style as CSSProperties | undefined) }} />
}

/** Auto-styled <textarea>. */
export function FieldTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        ...FIELD,
        resize: "vertical" as const,
        ...(props.style as CSSProperties | undefined),
      }}
    />
  )
}

/** Auto-styled <select>. */
export function FieldSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{ ...FIELD, ...(props.style as CSSProperties | undefined) }} />
}
