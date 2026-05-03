"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface MissingHost {
  installId: string
  deviceId: string
  hostname: string
  clientName: string
}

export default function PatchDeployForm({
  patchId,
  missingHosts,
}: {
  patchId: string
  missingHosts: MissingHost[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(missingHosts.map((h) => h.deviceId)),
  )
  const [dryRun, setDryRun] = useState(true)
  const [rebootPolicy, setRebootPolicy] = useState<"defer-if-user-active" | "force" | "never">(
    "defer-if-user-active",
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }
  function selectAll() {
    setSelectedIds(new Set(missingHosts.map((h) => h.deviceId)))
  }
  function selectNone() {
    setSelectedIds(new Set())
  }

  async function submit() {
    if (selectedIds.size === 0) {
      setError("Pick at least one host.")
      return
    }
    if (!dryRun) {
      const ok = window.confirm(
        `This is a REAL deploy (not dry-run) to ${selectedIds.size} host(s). Continue?`,
      )
      if (!ok) return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/patches/${patchId}/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceIds: Array.from(selectedIds),
          dryRun,
          rebootPolicy,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "Deploy failed")
        return
      }
      // Refresh the page so the install rows update.
      setOpen(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12,
          fontWeight: 500,
          padding: "8px 16px",
          borderRadius: 6,
          background: "var(--color-accent)",
          color: "#fff",
          border: "0.5px solid var(--color-border-secondary)",
          cursor: "pointer",
        }}
      >
        Deploy to {missingHosts.length} missing host{missingHosts.length === 1 ? "" : "s"} →
      </button>
    )
  }

  return (
    <div
      style={{
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 10,
        padding: 14,
        width: "100%",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 10,
        }}
      >
        Deploy patch
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          <span>Dry-run (recommended)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--color-text-muted)" }}>Reboot policy</span>
          <select
            value={rebootPolicy}
            onChange={(e) => setRebootPolicy(e.target.value as typeof rebootPolicy)}
            style={{
              padding: "3px 6px",
              borderRadius: 4,
              border: "0.5px solid var(--color-border-tertiary)",
              background: "var(--color-background-primary)",
              color: "var(--color-text-primary)",
              fontSize: 12,
            }}
          >
            <option value="never">never</option>
            <option value="defer-if-user-active">defer-if-user-active</option>
            <option value="force">force</option>
          </select>
        </label>
      </div>

      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 6 }}>
        Targets ({selectedIds.size} of {missingHosts.length} selected) ·{" "}
        <button
          onClick={selectAll}
          style={{ background: "none", border: "none", color: "var(--color-accent)", cursor: "pointer", padding: 0, fontSize: 11 }}
        >
          all
        </button>{" "}
        ·{" "}
        <button
          onClick={selectNone}
          style={{ background: "none", border: "none", color: "var(--color-accent)", cursor: "pointer", padding: 0, fontSize: 11 }}
        >
          none
        </button>
      </div>
      <div
        style={{
          maxHeight: 180,
          overflowY: "auto",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: 6,
          padding: 8,
          marginBottom: 12,
          fontSize: 12,
          background: "var(--color-background-primary)",
        }}
      >
        {missingHosts.map((h) => (
          <label
            key={h.deviceId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "3px 0",
              cursor: "pointer",
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(h.deviceId)}
              onChange={() => toggle(h.deviceId)}
            />
            <span>{h.hostname}</span>
            <span style={{ color: "var(--color-text-muted)" }}>· {h.clientName}</span>
          </label>
        ))}
      </div>

      {error && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--color-danger)",
            marginBottom: 10,
            padding: "6px 10px",
            background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
            borderRadius: 5,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={submit}
          disabled={submitting || selectedIds.size === 0}
          style={{
            fontSize: 12,
            fontWeight: 500,
            padding: "7px 14px",
            borderRadius: 6,
            background: "var(--color-accent)",
            color: "#fff",
            border: "0.5px solid var(--color-border-secondary)",
            cursor: submitting ? "wait" : "pointer",
            opacity: submitting || selectedIds.size === 0 ? 0.6 : 1,
          }}
        >
          {submitting ? "Dispatching…" : dryRun ? "Dispatch dry-run" : "Dispatch real deploy"}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={submitting}
          style={{
            fontSize: 12,
            padding: "7px 14px",
            borderRadius: 6,
            background: "transparent",
            color: "var(--color-text-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
