"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ConfirmModal } from "@/components/ui/ConfirmModal"

// Phase 9 WS-A §3.8 — bulk approve all KEV closing patches in
// `needs-approval` state. Typed-name confirm modal — operator
// must type the literal count to confirm. Reuses ConfirmModal
// from Phase 8.

interface Props {
  count: number
}

export default function BulkApproveKevButton({ count }: Props) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ approved: number } | { error: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  if (count === 0) return null

  const expected = `approve ${count} kev`

  async function approve() {
    setResult(null)
    const res = await fetch("/api/admin/patches/bulk-approve-kev", { method: "POST" })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setResult({ error: body.error ?? `HTTP ${res.status}` })
      return
    }
    const data = (await res.json()) as { approved: number }
    setResult({ approved: data.approved })
    startTransition(() => router.refresh())
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        style={{
          padding: "7px 14px",
          fontSize: 12,
          fontWeight: 600,
          background: "var(--color-danger)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: pending ? "not-allowed" : "pointer",
        }}
      >
        Approve all KEV ({count})
      </button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          await approve()
          setOpen(false)
        }}
        title="Bulk-approve KEV closing patches"
        body={
          <>
            You&apos;re about to approve <strong>{count}</strong> KEV-flagged closing
            patches that are currently <code>needs-approval</code>. They will become
            available for immediate deploy.
          </>
        }
        confirmLabel="Approve all KEV"
        tone="danger"
        typedName={{ expected, prompt: <>Type <code>{expected}</code> to confirm:</> }}
      />
      {result && "error" in result && (
        <div style={{ fontSize: 11, color: "var(--color-danger)", marginTop: 4 }}>
          {result.error}
        </div>
      )}
      {result && "approved" in result && (
        <div style={{ fontSize: 11, color: "var(--color-success)", marginTop: 4 }}>
          Approved {result.approved}.
        </div>
      )}
    </>
  )
}
