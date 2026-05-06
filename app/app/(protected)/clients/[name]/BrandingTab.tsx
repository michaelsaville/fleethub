"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

interface BrandingState {
  reportLogoUrl: string | null
  reportAccentColor: string
  reportFooterText: string | null
}

const DEFAULT_ACCENT = "#F97316"

export default function BrandingTab({
  tenantName,
  initial,
}: {
  tenantName: string
  initial: BrandingState
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<BrandingState>(initial)
  const [accentDraft, setAccentDraft] = useState(initial.reportAccentColor)
  const [footerDraft, setFooterDraft] = useState(initial.reportFooterText ?? "")
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [err, setErr] = useState<string | null>(null)

  async function patch(data: Partial<BrandingState>) {
    setSaving("saving")
    setErr(null)
    try {
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(tenantName)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        },
      )
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `Save failed (${res.status})`)
      setState((s) => ({ ...s, ...j.tenant }))
      setSaving("saved")
      setTimeout(() => setSaving((s) => (s === "saved" ? "idle" : s)), 1500)
      router.refresh()
    } catch (e) {
      setSaving("error")
      setErr(e instanceof Error ? e.message : "Save failed")
    }
  }

  async function uploadLogo(file: File) {
    setBusy(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(tenantName)}/logo`,
        { method: "POST", body: fd },
      )
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? `Upload failed (${res.status})`)
      await patch({ reportLogoUrl: j.url })
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <section
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 10,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 700,
      }}
    >
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Report branding</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
          Logo, accent color, and footer text used on every PDF report
          generated for {tenantName}.
        </p>
      </div>

      {/* Logo */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Label>Logo</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 80,
              height: 60,
              border: "0.5px dashed var(--color-border-tertiary)",
              borderRadius: 6,
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 4,
              flexShrink: 0,
            }}
          >
            {state.reportLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={state.reportLogoUrl}
                alt={`${tenantName} logo`}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            ) : (
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>(none)</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadLogo(f)
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                style={btnStyle(true)}
              >
                {busy ? "Uploading…" : state.reportLogoUrl ? "Replace" : "Upload"}
              </button>
              {state.reportLogoUrl && (
                <button
                  type="button"
                  onClick={() => void patch({ reportLogoUrl: null })}
                  disabled={busy}
                  style={btnStyle(false)}
                >
                  Remove
                </button>
              )}
            </div>
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0 }}>
              PNG, JPEG, or WebP. Renders ~50pt tall on the report cover.
              Under 2 MB.
            </p>
          </div>
        </div>
      </div>

      {/* Accent color */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Label>Accent color</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="color"
            value={accentDraft}
            onChange={(e) => setAccentDraft(e.target.value)}
            onBlur={() => {
              if (accentDraft.toLowerCase() !== state.reportAccentColor.toLowerCase()) {
                void patch({ reportAccentColor: accentDraft.toUpperCase() })
              }
            }}
            style={{ width: 50, height: 32, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, padding: 2, background: "transparent", cursor: "pointer" }}
          />
          <input
            type="text"
            value={accentDraft.toUpperCase()}
            onChange={(e) => setAccentDraft(e.target.value)}
            onBlur={() => {
              if (/^#[0-9a-fA-F]{6}$/.test(accentDraft)) {
                if (accentDraft.toLowerCase() !== state.reportAccentColor.toLowerCase()) {
                  void patch({ reportAccentColor: accentDraft.toUpperCase() })
                }
              }
            }}
            placeholder="#F97316"
            style={{
              fontSize: 13,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              padding: "6px 10px",
              borderRadius: 6,
              border: "0.5px solid var(--color-border-tertiary)",
              background: "var(--color-background-primary)",
              width: 120,
            }}
          />
          {accentDraft.toUpperCase() !== DEFAULT_ACCENT && (
            <button
              type="button"
              onClick={() => {
                setAccentDraft(DEFAULT_ACCENT)
                void patch({ reportAccentColor: DEFAULT_ACCENT })
              }}
              style={btnStyle(false)}
            >
              Reset to default
            </button>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0 }}>
          Tints the report kind label and the divider line under the
          tenant name on the cover. Default is {DEFAULT_ACCENT}.
        </p>
      </div>

      {/* Footer text */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Label>Footer text</Label>
        <input
          type="text"
          value={footerDraft}
          onChange={(e) => setFooterDraft(e.target.value)}
          onBlur={() => {
            const next = footerDraft.trim() || null
            if (next !== (state.reportFooterText ?? null)) {
              void patch({ reportFooterText: next })
            }
          }}
          placeholder={`${tenantName} - Confidential - FleetHub generated`}
          style={{
            fontSize: 13,
            padding: "7px 10px",
            borderRadius: 6,
            border: "0.5px solid var(--color-border-tertiary)",
            background: "var(--color-background-primary)",
          }}
        />
        <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0 }}>
          Replaces the default footer line on every PDF page. Compliance
          disclaimer, classification stamp, etc.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, fontSize: 11.5, color: "var(--color-text-muted)" }}>
        {saving === "saving" && <span>saving…</span>}
        {saving === "saved" && <span style={{ color: "var(--color-success)" }}>saved</span>}
        {saving === "error" && err && <span style={{ color: "var(--color-danger)" }}>{err}</span>}
      </div>
    </section>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </span>
  )
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: 6,
    border: primary
      ? "0.5px solid var(--color-accent)"
      : "0.5px solid var(--color-border-tertiary)",
    background: primary ? "var(--color-accent)" : "transparent",
    color: primary ? "#fff" : "var(--color-text-primary)",
    cursor: "pointer",
  }
}
