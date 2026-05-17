"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ConfirmModal } from "@/components/ui/ConfirmModal"

export default function PackageActions({
  packageId,
  isApproved,
  isArchived,
}: {
  packageId: string
  isApproved: boolean
  isArchived: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)

  async function action(path: string) {
    setBusy(path)
    try {
      const res = await fetch(`/api/packages/${packageId}/${path}`, { method: "POST" })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        alert(data.error || `HTTP ${res.status}`)
      }
      startTransition(() => router.refresh())
    } finally {
      setBusy(null)
    }
  }

  if (isArchived) return null

  return (
    <div style={{ display: "flex", gap: 6 }}>
      {!isApproved && (
        <button onClick={() => action("approve")} disabled={busy !== null} style={btn()}>
          {busy === "approve" ? "…" : "Approve"}
        </button>
      )}
      <button
        onClick={() => setArchiveConfirmOpen(true)}
        disabled={busy !== null}
        style={{ ...btn(), color: "var(--color-danger)" }}
      >
        {busy === "archive" ? "…" : "Archive"}
      </button>
      <ConfirmModal
        open={archiveConfirmOpen}
        onClose={() => setArchiveConfirmOpen(false)}
        onConfirm={() => action("archive")}
        title="Archive this package?"
        body="Existing deployments are unaffected. The package will no longer appear in pickers."
        confirmLabel="Archive"
        tone="danger"
      />
    </div>
  )
}

function btn(): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    border: "0.5px solid var(--color-border-tertiary)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  }
}
