"use client"

import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import Sidebar from "@/components/Sidebar"
import CommandPalette from "@/components/CommandPalette"

/**
 * Two-pane shell: sidebar + main content (with top bar).
 * The top bar holds the Cmd-K hint button, the alert badge (Phase 1
 * wires it to live count), and the user menu.
 *
 * Per UI-PATTERNS.md, this is intentionally NOT a faithful clone of
 * any one of the big three RMMs — it's the convergence (sidebar +
 * top bar + main) plus the differentiator (Cmd-K is first-class).
 */
export default function AppShell({
  children,
  openAlertsCount,
}: {
  children: React.ReactNode
  openAlertsCount?: number
}) {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login")
  }, [status, router])

  if (status === "loading") {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--color-text-muted)" }}>
        Loading…
      </div>
    )
  }
  if (status === "unauthenticated") return null

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar email={session?.user?.email ?? null} openAlertsCount={openAlertsCount} />
        <main style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>{children}</main>
      </div>
      <CommandPalette />
    </div>
  )
}

function TopBar({ email, openAlertsCount }: { email: string | null; openAlertsCount?: number }) {
  const showBadge = typeof openAlertsCount === "number" && openAlertsCount > 0
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 20px",
        borderBottom: "0.5px solid var(--color-border-secondary)",
        background: "var(--color-background-primary)",
        gap: "12px",
      }}
    >
      <CmdKButton />
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <a
          href="/alerts?state=open"
          aria-label={showBadge ? `${openAlertsCount} open alerts` : "Alerts"}
          title={showBadge ? `${openAlertsCount} open alerts` : "No open alerts"}
          style={{
            position: "relative",
            background: "transparent",
            border: "none",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
            fontSize: "16px",
            padding: "4px 8px",
            textDecoration: "none",
          }}
        >
          🔔
          {showBadge && (
            <span
              style={{
                position: "absolute",
                top: "2px",
                right: "2px",
                minWidth: "14px",
                height: "14px",
                padding: "0 4px",
                borderRadius: "999px",
                background: "var(--color-danger)",
                color: "white",
                fontSize: "9px",
                fontWeight: 600,
                display: "grid",
                placeItems: "center",
              }}
            >
              {openAlertsCount}
            </span>
          )}
        </a>
        <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{email}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{
            fontSize: "11px",
            padding: "4px 10px",
            borderRadius: "5px",
            border: "0.5px solid var(--color-border-secondary)",
            background: "transparent",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  )
}

/**
 * The Cmd-K hint button — clicking it dispatches a synthetic ⌘K so the
 * palette opens. Visible affordance for users who don't know the
 * shortcut yet (UI-PATTERNS.md "discoverability" priority).
 */
function CmdKButton() {
  function trigger() {
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    window.dispatchEvent(event)
  }
  return (
    <button
      onClick={trigger}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 12px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-secondary)",
        borderRadius: "6px",
        color: "var(--color-text-muted)",
        fontSize: "12px",
        cursor: "pointer",
        minWidth: "320px",
      }}
    >
      <span aria-hidden>🔍</span>
      <span style={{ flex: 1, textAlign: "left" }}>Search devices, clients, scripts…</span>
      <span style={{ display: "flex", gap: "3px", color: "var(--color-text-muted)" }}>
        <kbd
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: "10px",
            padding: "1px 5px",
            background: "var(--color-background-tertiary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "3px",
          }}
        >
          ⌘K
        </kbd>
      </span>
    </button>
  )
}
