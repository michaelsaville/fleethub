"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"

interface Props {
  id: string
  name: string
}

export default function DeleteGroupButton({ id, name }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  async function destroy() {
    setError(null)
    const res = await fetch(`/api/admin/device-groups/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    startTransition(() => router.push("/groups"))
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)} disabled={pending}>
        Delete
      </Button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          await destroy()
          if (!error) setOpen(false)
        }}
        title="Delete device group"
        body={<>This removes the targeting rule. Devices remain. Monitors/deployments still bound to this group must be unbound first.</>}
        confirmLabel="Delete group"
        tone="danger"
        typedName={{ expected: name, prompt: <>Type <code>{name}</code> to confirm:</> }}
      />
      {error && <InlineAlert tone="danger" style={{ marginTop: 8 }}>{error}</InlineAlert>}
    </>
  )
}
