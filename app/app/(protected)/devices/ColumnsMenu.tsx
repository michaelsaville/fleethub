"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { setHiddenColumns } from "@/lib/device-views"
import { HIDEABLE_COLUMN_IDS } from "@/lib/device-view-types"

const COLUMN_LABELS: Record<string, string> = {
  client: "Client",
  os: "OS",
  role: "Role",
  ip: "IP",
  lastSeen: "Last seen",
  alerts: "Alerts",
}

export default function ColumnsMenu({
  hiddenColumns,
}: {
  hiddenColumns: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Local copy so toggles feel instant; we sync to server on each change.
  const [local, setLocal] = useState<Set<string>>(new Set(hiddenColumns))

  useEffect(() => {
    setLocal(new Set(hiddenColumns))
  }, [hiddenColumns])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [])

  async function toggle(id: string) {
    if (busy) return
    const next = new Set(local)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setLocal(next)
    setBusy(true)
    try {
      const result = await setHiddenColumns(Array.from(next))
      if (result.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const visibleCount = HIDEABLE_COLUMN_IDS.length - local.size

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 11,
          padding: "5px 10px",
          borderRadius: 5,
          border: "0.5px solid var(--color-border-secondary)",
          background: "var(--color-background-secondary)",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
        title="Show / hide columns"
      >
        Columns
        <span style={{ color: "var(--color-text-muted)" }}>· {visibleCount}/{HIDEABLE_COLUMN_IDS.length}</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: 6,
            padding: 4,
            minWidth: 180,
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          }}
        >
          {HIDEABLE_COLUMN_IDS.map((id) => {
            const hidden = local.has(id)
            return (
              <label
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  borderRadius: 4,
                  color: hidden ? "var(--color-text-muted)" : "var(--color-text-primary)",
                }}
              >
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={() => toggle(id)}
                  disabled={busy}
                />
                {COLUMN_LABELS[id] ?? id}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
