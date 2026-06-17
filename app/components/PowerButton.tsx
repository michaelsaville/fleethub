"use client"
import { useState } from "react"

// WS-C — device power control. Dispatches power.reboot/shutdown/logoff
// to the agent via /api/admin/devices/[id]/power. reboot is TECH +
// confirm; shutdown/logoff return 202 approval-required (4-eyes) which
// we surface with a link to /approvals.

type Action = "reboot" | "shutdown" | "logoff"

const LABELS: Record<Action, string> = {
  reboot: "Reboot",
  shutdown: "Shut down",
  logoff: "Log off users",
}

export default function PowerButton({
  deviceId,
  online,
  hasAgent,
}: {
  deviceId: string
  online: boolean
  hasAgent: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<Action | null>(null)
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null)

  const disabled = !online || !hasAgent
  const title = !hasAgent ? "No enrolled agent" : !online ? "Device is offline" : "Power actions"

  async function run(action: Action) {
    setOpen(false)
    if (!window.confirm(`${LABELS[action]} this device? This affects the live endpoint.`)) return
    setBusy(action)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/devices/${deviceId}/power`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        status?: string
        reason?: string
        error?: string
      }
      if (res.status === 202 && json.status === "approval-required") {
        setMsg({ tone: "warn", text: `Needs peer approval — review in /approvals` })
      } else if (res.ok) {
        setMsg({ tone: "ok", text: `${LABELS[action]} dispatched` })
      } else {
        setMsg({ tone: "err", text: json.error ?? `HTTP ${res.status}` })
      }
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        disabled={disabled || busy !== null}
        title={title}
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "7px 12px",
          fontSize: "13px",
          borderRadius: "8px",
          border: "0.5px solid var(--color-border-tertiary)",
          background: "var(--color-background-tertiary)",
          color: disabled ? "var(--color-text-muted)" : "var(--color-text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        ⏻ {busy ? `${LABELS[busy]}…` : "Power"} ▾
      </button>
      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 20,
            minWidth: 160,
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "8px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
            overflow: "hidden",
          }}
        >
          {(Object.keys(LABELS) as Action[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => run(a)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                fontSize: "13px",
                background: "transparent",
                border: "none",
                color: "var(--color-text-primary)",
                cursor: "pointer",
              }}
            >
              {LABELS[a]}
              {a !== "reboot" && (
                <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}> · needs approval</span>
              )}
            </button>
          ))}
        </div>
      )}
      {msg && (
        <span
          style={{
            marginLeft: 8,
            fontSize: 12,
            color:
              msg.tone === "ok"
                ? "var(--color-success)"
                : msg.tone === "warn"
                  ? "var(--color-warning, #b45309)"
                  : "var(--color-danger, #dc2626)",
          }}
        >
          {msg.text}
        </span>
      )}
    </div>
  )
}
