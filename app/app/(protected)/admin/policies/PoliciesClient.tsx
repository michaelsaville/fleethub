"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

interface Tenant {
  id: string
  name: string
  hipaaMode: boolean
  mfaRequired: boolean
  bulkApprovalThreshold: number
  disclosureRequiresApproval: boolean
  shellApprovalTagsJson: string | null
  backupTriggerEnabled: boolean
  remoteControlEnabled: boolean
  portalEnabled: boolean
  sessionMaxHours: number
}

type PolicyField =
  | "mfaRequired"
  | "disclosureRequiresApproval"
  | "bulkApprovalThreshold"
  | "remoteControlEnabled"
  | "portalEnabled"
  | "backupTriggerEnabled"
  | "sessionMaxHours"

const FIELDS: { id: PolicyField; label: string; kind: "boolean" | "number" }[] = [
  { id: "mfaRequired", label: "MFA required", kind: "boolean" },
  { id: "disclosureRequiresApproval", label: "Disclosure 4-eyes", kind: "boolean" },
  { id: "bulkApprovalThreshold", label: "Bulk threshold", kind: "number" },
  { id: "remoteControlEnabled", label: "Remote", kind: "boolean" },
  { id: "portalEnabled", label: "Portal", kind: "boolean" },
  { id: "backupTriggerEnabled", label: "Backup trigger", kind: "boolean" },
  { id: "sessionMaxHours", label: "Session max (h)", kind: "number" },
]

export default function PoliciesClient({ tenants }: { tenants: Tenant[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedTenant, setSavedTenant] = useState<string | null>(null)

  // Bulk form state
  const [bulkField, setBulkField] = useState<PolicyField>("mfaRequired")
  const [bulkBool, setBulkBool] = useState<boolean>(true)
  const [bulkNum, setBulkNum] = useState<number>(50)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  async function patchOne(tenantName: string, field: PolicyField, value: boolean | number) {
    setError(null)
    setSavedTenant(null)
    const body: Record<string, unknown> = { [field]: value }
    const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantName)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(`${tenantName}: ${j.error ?? `HTTP ${res.status}`}`)
      return
    }
    setSavedTenant(tenantName)
    startTransition(() => router.refresh())
  }

  async function applyBulk() {
    setError(null)
    setBulkResult(null)
    if (bulkSelected.size === 0) {
      setError("select at least one tenant")
      return
    }
    const field = FIELDS.find((f) => f.id === bulkField)!
    const value = field.kind === "boolean" ? bulkBool : bulkNum
    let ok = 0
    let fail = 0
    for (const tenantName of bulkSelected) {
      const body: Record<string, unknown> = { [bulkField]: value }
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantName)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) ok++
      else fail++
    }
    setBulkResult(`Applied to ${ok} tenant(s); ${fail} failed`)
    startTransition(() => router.refresh())
  }

  function toggleBulkSelect(name: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }
  function selectAll() {
    setBulkSelected(new Set(tenants.map((t) => t.name)))
  }
  function selectNone() {
    setBulkSelected(new Set())
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {savedTenant && (
        <div style={{ fontSize: 11.5, color: "var(--color-success)" }}>
          Saved {savedTenant}
        </div>
      )}

      {/* Matrix table */}
      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={cellHead}>
                <input
                  type="checkbox"
                  checked={bulkSelected.size === tenants.length && tenants.length > 0}
                  onChange={(e) => (e.target.checked ? selectAll() : selectNone())}
                />
              </th>
              <th style={cellHead}>Tenant</th>
              {FIELDS.map((f) => (
                <th key={f.id} style={cellHead}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id}>
                <td style={cell}>
                  <input
                    type="checkbox"
                    checked={bulkSelected.has(t.name)}
                    onChange={() => toggleBulkSelect(t.name)}
                  />
                </td>
                <td style={{ ...cell, fontWeight: 500 }}>
                  {t.name}
                  {t.hipaaMode && (
                    <span style={hipaaPill}>HIPAA</span>
                  )}
                </td>
                {FIELDS.map((f) => (
                  <td key={f.id} style={cell}>
                    {f.kind === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={t[f.id] as boolean}
                        disabled={pending}
                        onChange={(e) => patchOne(t.name, f.id, e.target.checked)}
                      />
                    ) : (
                      <input
                        type="number"
                        defaultValue={t[f.id] as number}
                        min={1}
                        max={f.id === "sessionMaxHours" ? 168 : 100000}
                        disabled={pending}
                        onBlur={(e) => {
                          const v = Number(e.target.value)
                          if (Number.isFinite(v) && v !== t[f.id]) patchOne(t.name, f.id, v)
                        }}
                        style={{ ...FIELD, width: 80 }}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bulk form */}
      <div
        style={{
          borderTop: "0.5px solid var(--color-border-tertiary)",
          paddingTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={TYPOGRAPHY.LABEL_CAPS}>
          Apply across {bulkSelected.size} selected tenant{bulkSelected.size === 1 ? "" : "s"}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={bulkField}
            onChange={(e) => setBulkField(e.target.value as PolicyField)}
            style={{ ...FIELD, width: 220 }}
          >
            {FIELDS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          {FIELDS.find((f) => f.id === bulkField)?.kind === "boolean" ? (
            <select
              value={bulkBool ? "true" : "false"}
              onChange={(e) => setBulkBool(e.target.value === "true")}
              style={{ ...FIELD, width: 120 }}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              type="number"
              value={bulkNum}
              min={1}
              max={100000}
              onChange={(e) => setBulkNum(Number(e.target.value))}
              style={{ ...FIELD, width: 120 }}
            />
          )}
          <Button
            variant="primary"
            onClick={applyBulk}
            disabled={pending || bulkSelected.size === 0}
          >
            Apply to {bulkSelected.size}
          </Button>
        </div>
        {bulkResult && (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {bulkResult}
          </div>
        )}
      </div>
    </div>
  )
}

const cellHead: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "0.5px solid var(--color-border-tertiary)",
  whiteSpace: "nowrap",
}

const cell: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "0.5px solid var(--color-border-tertiary)",
  whiteSpace: "nowrap",
}

const hipaaPill: React.CSSProperties = {
  display: "inline-block",
  marginLeft: 8,
  padding: "1px 6px",
  fontSize: 9.5,
  fontWeight: 700,
  background: "var(--color-tone-warn-bg, #fef3c7)",
  color: "var(--color-tone-warn-text, #78350f)",
  borderRadius: 999,
}
