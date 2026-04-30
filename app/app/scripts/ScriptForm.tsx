import type { Fl_Script } from "@prisma/client"

interface ScriptFormProps {
  action: (formData: FormData) => void | Promise<void>
  submitLabel: string
  script?: Fl_Script
  readOnly?: boolean
}

const SHELLS = ["powershell", "bash", "batch"] as const

export function ScriptForm({ action, submitLabel, script, readOnly }: ScriptFormProps) {
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {script && <input type="hidden" name="id" value={script.id} />}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)", gap: "12px" }}>
        <Field label="Name" required>
          <input
            type="text"
            name="name"
            required
            defaultValue={script?.name ?? ""}
            disabled={readOnly}
            placeholder="CleanTempFiles"
            style={inputStyle}
          />
        </Field>
        <Field label="Shell" required>
          <select name="shell" defaultValue={script?.shell ?? "powershell"} disabled={readOnly} style={inputStyle}>
            {SHELLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <input
            type="text"
            name="category"
            defaultValue={script?.category ?? ""}
            disabled={readOnly}
            placeholder="maintenance"
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Description">
        <input
          type="text"
          name="description"
          defaultValue={script?.description ?? ""}
          disabled={readOnly}
          placeholder="One-line summary shown in the library"
          style={inputStyle}
        />
      </Field>

      <Field label="Body" required>
        <textarea
          name="body"
          required
          defaultValue={script?.body ?? ""}
          disabled={readOnly}
          rows={18}
          spellCheck={false}
          style={{
            ...inputStyle,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: "12px",
            lineHeight: 1.5,
            resize: "vertical",
          }}
        />
      </Field>

      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
        <input type="checkbox" name="isCurated" defaultChecked={script?.isCurated ?? false} disabled={readOnly} />
        Add to curated library (visible to all techs)
      </label>

      {!readOnly && (
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="submit" style={primaryButtonStyle}>{submitLabel}</button>
        </div>
      )}
    </form>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
        {label}
        {required && <span style={{ color: "var(--color-danger)" }}> *</span>}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-background-tertiary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "6px",
  padding: "7px 10px",
  color: "var(--color-text-primary)",
  fontSize: "13px",
  fontFamily: "inherit",
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "7px 16px",
  background: "var(--color-accent)",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
}
