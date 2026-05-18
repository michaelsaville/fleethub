"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

/**
 * Click-to-edit operator label on /devices/[id]. Click the name (or
 * the "+ name" affordance when empty) to enter edit mode; Enter or
 * blur saves, Esc cancels. Sends PATCH /api/devices/[id] then
 * router.refresh() so the server-rendered header + the rest of the
 * page reflect the new value without a full reload.
 */
export default function FriendlyNameEditor({
  deviceId,
  initial,
  hostname,
}: {
  deviceId: string
  initial: string | null
  hostname: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial ?? "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function commit() {
    if (busy) return
    const trimmed = value.trim()
    if (trimmed === (initial ?? "")) {
      setEditing(false)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/devices/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendlyName: trimmed }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(data.error ?? `HTTP ${res.status}`)
        return
      }
      setEditing(false)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    setValue(initial ?? "")
    setErr(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              cancel()
            }
          }}
          disabled={busy}
          maxLength={120}
          placeholder="e.g. Reception desk · Sarah"
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            padding: "2px 6px",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: 4,
            color: "var(--color-text-primary)",
            minWidth: 280,
          }}
        />
        {err && (
          <span style={{ fontSize: 11, color: "var(--color-danger)" }}>{err}</span>
        )}
      </span>
    )
  }

  if (!initial) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={`Set a friendly name for ${hostname}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontSize: 13,
          padding: "2px 8px",
          border: "0.5px dashed var(--color-border-secondary)",
          borderRadius: 4,
          color: "var(--color-text-muted)",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        + friendly name
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit friendly name"
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        padding: 0,
        margin: 0,
        background: "transparent",
        border: "none",
        color: "var(--color-text-primary)",
        cursor: "text",
      }}
    >
      {initial}
    </button>
  )
}
