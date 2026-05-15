"use client"
import { useRouter } from "next/navigation"
import { useTransition } from "react"

export default function RefreshButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      style={{
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: 600,
        color: "var(--color-text-secondary)",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "6px",
        cursor: pending ? "not-allowed" : "pointer",
        opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  )
}
