"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

interface Props {
  tenants: string[]
  snmpCreds: { id: string; tenantName: string; label: string }[]
}

const KINDS = ["switch", "router", "firewall", "ap", "printer", "ups", "other"]

export default function NetworkDeviceCreateForm({ tenants, snmpCreds }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [clientName, setClientName] = useState(tenants[0] ?? "")
  const [displayName, setDisplayName] = useState("")
  const [ipAddress, setIpAddress] = useState("")
  const [kind, setKind] = useState("switch")
  const [snmpVersion, setSnmpVersion] = useState<"none" | "v2c" | "v3">("none")
  const [snmpCredentialId, setSnmpCredentialId] = useState("")
  const [icmpEnabled, setIcmpEnabled] = useState(true)
  const [pollIntervalSec, setPollIntervalSec] = useState(60)

  const credsForTenant = snmpCreds.filter((c) => c.tenantName === clientName)

  async function submit() {
    setErr(null)
    const res = await fetch("/api/admin/network-devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName,
        displayName,
        ipAddress,
        kind,
        snmpVersion,
        snmpCredentialId: snmpVersion === "none" ? null : snmpCredentialId || null,
        icmpEnabled,
        pollIntervalSec,
      }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setErr(j.error ?? `HTTP ${res.status}`)
      return
    }
    const { id } = (await res.json()) as { id: string }
    startTransition(() => router.push(`/network-devices/${id}`))
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {err && <InlineAlert tone="danger">{err}</InlineAlert>}
      <Field label="Tenant">
        <select value={clientName} onChange={(e) => setClientName(e.target.value)} style={FIELD}>
          {tenants.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="Display name">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Core switch · Suite 200"
          style={FIELD}
        />
      </Field>
      <Field label="IP address">
        <input
          value={ipAddress}
          onChange={(e) => setIpAddress(e.target.value)}
          placeholder="10.0.0.1"
          style={{ ...FIELD, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
        />
      </Field>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={FIELD}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="ICMP enabled">
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={icmpEnabled} onChange={(e) => setIcmpEnabled(e.target.checked)} />
          Probe via ICMP ping
        </label>
      </Field>
      <Field label="Poll interval (sec)">
        <input
          type="number"
          min={10}
          max={3600}
          value={pollIntervalSec}
          onChange={(e) => setPollIntervalSec(Number(e.target.value))}
          style={{ ...FIELD, width: 100 }}
        />
        <span style={{ ...TYPOGRAPHY.HINT, marginTop: 4 }}>
          Default 60. Cron tick is 30s; this gates per-device pacing.
        </span>
      </Field>
      <Field label="SNMP version">
        <select
          value={snmpVersion}
          onChange={(e) => setSnmpVersion(e.target.value as typeof snmpVersion)}
          style={FIELD}
        >
          <option value="none">none</option>
          <option value="v2c">v2c</option>
          <option value="v3">v3</option>
        </select>
      </Field>
      {snmpVersion !== "none" && (
        <Field label="SNMP credential (vault)">
          <select
            value={snmpCredentialId}
            onChange={(e) => setSnmpCredentialId(e.target.value)}
            style={FIELD}
          >
            <option value="">— select credential —</option>
            {credsForTenant.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <span style={{ ...TYPOGRAPHY.HINT, marginTop: 4 }}>
            Seal an snmp-v3 credential first via Policies → Credentials.
          </span>
        </Field>
      )}
      <div style={{ marginTop: 8 }}>
        <Button variant="primary" onClick={submit} disabled={pending || !displayName || !ipAddress}>
          Create device
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={TYPOGRAPHY.LABEL_CAPS}>{label}</span>
      {children}
    </div>
  )
}
