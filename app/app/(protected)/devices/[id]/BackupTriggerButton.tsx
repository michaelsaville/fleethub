"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 9 WS-C §5.4 — operator-initiated backup trigger button on
// /devices/[id] Posture card. Per-tenant gate; modal collects an
// optional/required justification per tenant policy.

interface Props {
  deviceId: string
  product: string
  enabled: boolean
  requiresJustification: boolean
}

export default function BackupTriggerButton({ deviceId, product, enabled, requiresJustification }: Props) {
  const [open, setOpen] = useState(false)
  const [justification, setJustification] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  if (!enabled) {
    return (
      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }} title="Tenant.backupTriggerEnabled is false">
        backup trigger disabled
      </span>
    )
  }
  if (!product || product === "none") {
    return (
      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }} title="Install a backup product (Veeam/Datto/restic/Windows-Backup) + wait for posture refresh">
        no backup product
      </span>
    )
  }

  async function trigger() {
    setError(null)
    setSuccess(false)
    const res = await fetch(`/api/admin/devices/${deviceId}/backup/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ justification }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    setSuccess(true)
    startTransition(() => router.refresh())
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={pending}>
        Trigger backup now
      </Button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          if (requiresJustification && !justification.trim()) {
            setError("Justification required")
            return
          }
          await trigger()
          if (!error) setOpen(false)
        }}
        title={`Trigger ${product} backup now`}
        body={
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0 }}>
              The agent will run the {product} backup binary on the host.
              Audit-logged. The run row updates state as the agent reports back.
            </p>
            {requiresJustification && (
              <div>
                <label style={TYPOGRAPHY.LABEL_CAPS}>
                  Justification (required by tenant policy)
                </label>
                <textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={3}
                  style={{ ...FIELD, width: "100%", marginTop: 4 }}
                  placeholder="Why now? (ticket id, change window, …)"
                />
              </div>
            )}
          </div>
        }
        confirmLabel="Trigger"
        tone="primary"
      />
      {error && <InlineAlert tone="danger" style={{ marginTop: 8 }}>{error}</InlineAlert>}
      {success && <InlineAlert tone="ok" style={{ marginTop: 8 }}>Queued — see Backups list below.</InlineAlert>}
    </>
  )
}
