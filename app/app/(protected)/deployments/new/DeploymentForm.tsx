"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"

interface PackageOpt {
  id: string
  name: string
  tenantName: string
  os: string
  source: string
  rebootPolicy: string
  versions: { id: string; version: string; isApprovedDefault: boolean }[]
}
interface RingOpt {
  id: string
  name: string
  tenantName: string
  isDefault: boolean
}
interface DeviceOpt {
  id: string
  hostname: string
  clientName: string
  os: string | null
  role: string | null
  isOnline: boolean
  maintenanceMode: boolean
}

export default function DeploymentForm({
  packages,
  rings,
  devices,
  defaultPackageId,
  defaultRingId,
  defaultTargetIds,
}: {
  packages: PackageOpt[]
  rings: RingOpt[]
  devices: DeviceOpt[]
  defaultPackageId: string | null
  defaultRingId: string | null
  defaultTargetIds: string[]
}) {
  const router = useRouter()
  const [packageId, setPackageId] = useState(defaultPackageId ?? packages[0]?.id ?? "")
  const selectedPackage = useMemo(() => packages.find((p) => p.id === packageId), [packages, packageId])

  const [versionId, setVersionId] = useState(() => {
    const def = selectedPackage?.versions.find((v) => v.isApprovedDefault) ?? selectedPackage?.versions[0]
    return def?.id ?? ""
  })
  const [ringId, setRingId] = useState(() => {
    if (defaultRingId) return defaultRingId
    const tenant = selectedPackage?.tenantName
    const tenantRing = rings.find((r) => r.tenantName === tenant && r.isDefault)
    return tenantRing?.id ?? rings[0]?.id ?? ""
  })
  const [action, setAction] = useState<"install" | "uninstall" | "update">("install")
  const [dryRun, setDryRun] = useState(true)
  const [filter, setFilter] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultTargetIds)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tenantName = selectedPackage?.tenantName ?? ""
  const filteredDevices = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return devices
      .filter((d) => !tenantName || d.clientName === tenantName)
      .filter((d) => !q || d.hostname.toLowerCase().includes(q) || (d.role ?? "").toLowerCase().includes(q))
  }, [devices, filter, tenantName])

  function toggle(id: string) {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!packageId || !versionId || !ringId || selectedIds.length === 0) {
      setError("Pick a package, version, ring, and at least one target")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantName,
          packageId,
          packageVersionId: versionId,
          ringId,
          action,
          dryRun,
          targetDeviceIds: selectedIds,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const dep = (await res.json()) as { id: string }
      router.push(`/deployments/${dep.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const ringsForTenant = rings.filter((r) => !tenantName || r.tenantName === tenantName)
  const droppedToMaintenance = selectedIds.filter((id) => devices.find((d) => d.id === id)?.maintenanceMode).length

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card title="Package + version">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: "12px" }}>
          <Field label="Package">
            <select value={packageId} onChange={(e) => {
              setPackageId(e.target.value)
              const next = packages.find((p) => p.id === e.target.value)
              const v = next?.versions.find((v) => v.isApprovedDefault) ?? next?.versions[0]
              setVersionId(v?.id ?? "")
              const r = rings.find((r) => r.tenantName === next?.tenantName && r.isDefault) ?? rings[0]
              setRingId(r?.id ?? "")
            }} style={input()}>
              <option value="">— pick a package —</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.tenantName}] {p.name} · {p.os} · {p.source}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Version">
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)} style={input()}>
              <option value="">— pick version —</option>
              {selectedPackage?.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.version}{v.isApprovedDefault ? " (approved)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {selectedPackage && (
          <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 8 }}>
            Reboot policy: <strong>{selectedPackage.rebootPolicy}</strong> · OS scope: {selectedPackage.os}
          </p>
        )}
      </Card>

      <Card title="Rollout">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 200px", gap: "12px" }}>
          <Field label="Update ring">
            <select value={ringId} onChange={(e) => setRingId(e.target.value)} style={input()}>
              <option value="">— pick ring —</option>
              {ringsForTenant.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Action">
            <select value={action} onChange={(e) => setAction(e.target.value as "install" | "uninstall" | "update")} style={input()}>
              <option value="install">Install</option>
              <option value="update">Update</option>
              <option value="uninstall">Uninstall</option>
            </select>
          </Field>
          <Field label="Dry run">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, height: 32, paddingLeft: 4 }}>
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              <span>Default true; uncheck to apply</span>
            </label>
          </Field>
        </div>
      </Card>

      <Card title={`Targets — ${selectedIds.length} selected`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="search"
            placeholder="Filter by hostname or role…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ ...input(), flex: 1 }}
          />
          <button
            type="button"
            onClick={() => setSelectedIds(filteredDevices.map((d) => d.id))}
            style={btnGhost()}
          >
            Select all ({filteredDevices.length})
          </button>
          <button type="button" onClick={() => setSelectedIds([])} style={btnGhost()}>
            Clear
          </button>
        </div>
        {droppedToMaintenance > 0 && (
          <p style={{ fontSize: 11, color: "var(--color-warn)", marginBottom: 8 }}>
            ⚠ {droppedToMaintenance} selected host{droppedToMaintenance === 1 ? " is" : "s are"} in Maintenance Mode and will be skipped.
          </p>
        )}
        <div style={{ maxHeight: 280, overflow: "auto", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", background: "var(--color-background-tertiary)" }}>
                <th style={{ ...th(), width: 30 }}></th>
                <th style={th()}>Hostname</th>
                <th style={th()}>Client</th>
                <th style={th()}>OS</th>
                <th style={th()}>Role</th>
                <th style={th()}>State</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((d) => (
                <tr
                  key={d.id}
                  style={{
                    borderTop: "0.5px solid var(--color-border-tertiary)",
                    background: selectedIds.includes(d.id) ? "var(--color-background-tertiary)" : "transparent",
                    cursor: "pointer",
                  }}
                  onClick={() => toggle(d.id)}
                >
                  <td style={td()}><input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggle(d.id)} /></td>
                  <td style={td()}>{d.hostname}</td>
                  <td style={td()}>{d.clientName}</td>
                  <td style={td()}>{d.os ?? "—"}</td>
                  <td style={td()}>{d.role ?? "—"}</td>
                  <td style={td()}>
                    {d.maintenanceMode && <span style={{ color: "var(--color-warn)", fontWeight: 600 }}>🔒 maintenance</span>}
                    {!d.maintenanceMode && d.isOnline && <span style={{ color: "var(--color-success)" }}>online</span>}
                    {!d.maintenanceMode && !d.isOnline && <span style={{ color: "var(--color-text-muted)" }}>offline</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {error && <p style={{ color: "var(--color-danger)", fontSize: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={() => router.push("/deployments")} style={btnGhost()}>
          Cancel
        </button>
        <button type="submit" disabled={busy} style={btnPrimary()}>
          {busy ? "Creating…" : dryRun ? "Start dry-run deployment" : "Apply deployment"}
        </button>
      </div>
    </form>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
      <div style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</div>
      <div style={{ padding: "14px" }}>{children}</div>
    </section>
  )
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
  return {
    fontSize: 13,
    padding: "7px 10px",
    borderRadius: 6,
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background)",
    color: "var(--color-text-primary)",
    width: "100%",
  }
}
function btnPrimary(): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 500,
    padding: "8px 16px",
    borderRadius: 6,
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-accent)",
    color: "#fff",
    cursor: "pointer",
  }
}
function btnGhost(): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 500,
    padding: "8px 14px",
    borderRadius: 6,
    border: "0.5px solid var(--color-border-tertiary)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  }
}
function th(): React.CSSProperties {
  return { textAlign: "left", padding: "6px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "6px 10px", color: "var(--color-text-primary)", verticalAlign: "middle" }
}
