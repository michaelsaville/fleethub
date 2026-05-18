"use client"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import "xterm/css/xterm.css"

// Phase 12 WS-D.3 — interactive shell terminal in a right-side
// drawer. xterm + xterm-addon-fit dynamic-imported so the ~80KB
// bundle only ships when the drawer opens.
//
// The drawer talks to Fl_ShellSession via SSE/WSS once the pcc2k-agent
// shell.open verb lands (operator-side commit, Phase 12 exit-gate).
// Until then, the drawer renders a placeholder explaining the agent
// dependency. The FH-side session row + dispatch IS shipped (Phase
// 10), so the drawer is functional minus live byte streaming.

interface Props {
  open: boolean
  onClose: () => void
  deviceId: string
  deviceHostname: string
  sessionId: string | null
  agentSupportsShell: boolean
}

export default function XtermDrawer({
  open,
  onClose,
  deviceId: _deviceId,
  deviceHostname,
  sessionId,
  agentSupportsShell,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  // ESC closes the drawer. Implementation note: passive listener so
  // any in-page form Esc handling still works.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // Lazy xterm initialization. Dynamic-import so SSR + initial bundle
  // stay light; xterm is browser-only anyway.
  useEffect(() => {
    if (!open || !sessionId || !agentSupportsShell) return
    let term: { dispose(): void } | null = null
    ;(async () => {
      try {
        const { Terminal } = await import("xterm")
        const { FitAddon } = await import("xterm-addon-fit")
        if (!containerRef.current) return
        const t = new Terminal({
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          cursorBlink: true,
        })
        const fit = new FitAddon()
        t.loadAddon(fit)
        t.open(containerRef.current)
        fit.fit()
        t.write("FleetHub shell — session " + sessionId.slice(0, 8) + "\r\n")
        t.write("Awaiting agent capability advertisement…\r\n")
        // TODO: open WSS connection here once gateway is ready
        term = t
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      term?.dispose()
    }
  }, [open, sessionId, agentSupportsShell])

  async function disconnect() {
    if (!sessionId) {
      onClose()
      return
    }
    setClosing(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/shell-sessions/${sessionId}/close`, {
        method: "POST",
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(j.error ?? `HTTP ${res.status}`)
        return
      }
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setClosing(false)
    }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 50,
        }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "max(720px, 60vw)",
          background: "var(--color-background-primary, #fff)",
          borderLeft: "0.5px solid var(--color-border-secondary)",
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
        }}
        role="dialog"
        aria-label={`Shell to ${deviceHostname}`}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 14px",
            borderBottom: "0.5px solid var(--color-border-tertiary)",
            background: "var(--color-background-secondary)",
          }}
        >
          <strong style={{ fontSize: 13 }}>Shell · {deviceHostname}</strong>
          {sessionId && (
            <code style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              session {sessionId.slice(0, 8)}…
            </code>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="danger" size="sm" onClick={disconnect} disabled={closing}>
            {closing ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
        {!agentSupportsShell ? (
          <div style={{ padding: 20 }}>
            <InlineAlert tone="warn">
              The agent on this device has not advertised <code>shell.open</code>
              capability yet. Operator-side commit pending (see
              ROADMAP.md Phase 12 exit-gate for the Go-side verb).
            </InlineAlert>
            <div style={{ ...TYPOGRAPHY.HINT, marginTop: 12 }}>
              FH-side Fl_ShellSession + dispatchToAgent shipped in Phase 10.
              Drawer activates the moment the agent reports shell capability.
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, padding: 8, background: "#000" }}>
            <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
          </div>
        )}
        {err && (
          <div style={{ padding: "8px 14px" }}>
            <InlineAlert tone="danger">{err}</InlineAlert>
          </div>
        )}
      </div>
    </>
  )
}
