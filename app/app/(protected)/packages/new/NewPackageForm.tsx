"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function NewPackageForm({ tenants }: { tenants: string[] }) {
  const router = useRouter()
  const [tenantName, setTenantName] = useState(tenants[0] ?? "")
  const [name, setName] = useState("")
  const [source, setSource] = useState<"winget" | "choco" | "brew" | "custom">("winget")
  const [sourceId, setSourceId] = useState("")
  const [os, setOs] = useState<"windows" | "macos" | "linux" | "any">("windows")
  const [category, setCategory] = useState("browser")
  const [version, setVersion] = useState("")
  const [filename, setFilename] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantName || !name || !sourceId) {
      setError("tenant, name, and sourceId required")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantName,
          name,
          source,
          sourceId,
          os,
          category,
          parseFromFilename: source === "custom" ? filename : undefined,
          initialVersion: version ? { version } : undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const pkg = (await res.json()) as { id: string }
      router.push(`/packages/${pkg.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card title="Identity">
        <Grid>
          <Field label="Tenant">
            <select value={tenantName} onChange={(e) => setTenantName(e.target.value)} style={input()}>
              {tenants.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} style={input()} placeholder="Google Chrome" />
          </Field>
          <Field label="Category">
            <input value={category} onChange={(e) => setCategory(e.target.value)} style={input()} />
          </Field>
        </Grid>
      </Card>

      <Card title="Source">
        <Grid>
          <Field label="Source">
            <select value={source} onChange={(e) => setSource(e.target.value as "winget" | "choco" | "brew" | "custom")} style={input()}>
              <option value="winget">winget</option>
              <option value="choco">choco</option>
              <option value="brew">brew</option>
              <option value="custom">custom (MSI / PKG / DEB)</option>
            </select>
          </Field>
          <Field label="OS">
            <select value={os} onChange={(e) => setOs(e.target.value as "windows" | "macos" | "linux" | "any")} style={input()}>
              <option value="windows">Windows</option>
              <option value="macos">macOS</option>
              <option value="linux">Linux</option>
              <option value="any">any</option>
            </select>
          </Field>
        </Grid>
        <div style={{ marginTop: 12 }}>
          <Field label={source === "custom" ? 'Source ID (custom: prefix; e.g. "custom:internal-tool")' : "Source ID"}>
            <input value={sourceId} onChange={(e) => setSourceId(e.target.value)} style={input()} placeholder={source === "winget" ? "Google.Chrome" : source === "choco" ? "googlechrome" : source === "brew" ? "google-chrome" : "custom:my-internal-app"} />
          </Field>
        </div>
        {source === "custom" && (
          <div style={{ marginTop: 12 }}>
            <Field label="Filename to mock-parse (.msi / .pkg / .deb)">
              <input value={filename} onChange={(e) => setFilename(e.target.value)} style={input()} placeholder="my-internal-app-2024.msi" />
            </Field>
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 6 }}>
              v1 mock-parse: returns a synthetic ProductCode + silent flags so the upload UX is exercisable.
              Real parsing via <code>msiinfo</code> / <code>pkgutil</code> ships when those binaries land in the container.
            </p>
          </div>
        )}
      </Card>

      <Card title="Initial version">
        <Field label="Version string (e.g. 122.0.6261.95). Leave blank to set later.">
          <input value={version} onChange={(e) => setVersion(e.target.value)} style={input()} placeholder="122.0.6261.95" />
        </Field>
      </Card>

      {error && <p style={{ color: "var(--color-danger)", fontSize: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={() => router.push("/packages")} style={btnGhost()}>Cancel</button>
        <button type="submit" disabled={busy} style={btnPrimary()}>
          {busy ? "Creating…" : "Create package"}
        </button>
      </div>
    </form>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
      <div style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  )
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}
function input(): React.CSSProperties {
  return { fontSize: 13, padding: "7px 10px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background)", color: "var(--color-text-primary)", width: "100%" }
}
function btnPrimary(): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: "8px 16px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-accent)", color: "#fff", cursor: "pointer" }
}
function btnGhost(): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: "8px 14px", borderRadius: 6, border: "0.5px solid var(--color-border-tertiary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }
}
