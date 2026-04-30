"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

interface NavItem {
  href: string
  label: string
  icon: string
  /** Live badge count from server; null = no badge. Phase 0 mocks. */
  badge?: number | null
}

/**
 * Per UI-PATTERNS.md: 9-section sidebar in this exact order. Order
 * encodes "what do techs use most" — Dashboard / Clients / Devices
 * are top because they're the most-used; Setup is at bottom because
 * it's rarely touched. Don't reorder without updating the doc.
 */
const NAV_ITEMS: NavItem[] = [
  { href: "/",         label: "Dashboard",  icon: "🏠" },
  { href: "/clients",  label: "Clients",    icon: "🏢" },
  { href: "/devices",  label: "Devices",    icon: "💻" },
  { href: "/alerts",   label: "Alerts",     icon: "🔔" },
  { href: "/patches",  label: "Patches",    icon: "🩹" },
  { href: "/scripts",  label: "Scripts",    icon: "⚡" },
  { href: "/software", label: "Software",   icon: "📦" },
  { href: "/reports",  label: "Reports",    icon: "📊" },
  { href: "/setup",    label: "Setup",      icon: "⚙️" },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const itemBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px",
    fontSize: "13px",
    color: "var(--color-text-secondary)",
    textDecoration: "none",
    borderRadius: "6px",
    transition: "background 0.12s",
    cursor: "pointer",
    border: "1px solid transparent",
  }

  return (
    <aside
      style={{
        width: collapsed ? "56px" : "200px",
        flexShrink: 0,
        background: "var(--color-background-secondary)",
        borderRight: "0.5px solid var(--color-border-secondary)",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.15s ease",
      }}
    >
      <div
        style={{
          padding: collapsed ? "16px 12px" : "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
        }}
      >
        {!collapsed && (
          <Link href="/" style={{ textDecoration: "none", color: "var(--color-text-primary)" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", letterSpacing: "-0.01em" }}>
              FleetHub
            </div>
            <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
              Phase 0 · scaffold
            </div>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            padding: "4px 6px",
            borderRadius: "4px",
          }}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "8px" }}>
        {NAV_ITEMS.map(item => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                ...itemBase,
                background: active ? "var(--color-background-tertiary)" : "transparent",
                color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                borderColor: active ? "var(--color-border-tertiary)" : "transparent",
                justifyContent: collapsed ? "center" : "flex-start",
              }}
              title={collapsed ? item.label : undefined}
            >
              <span aria-hidden style={{ fontSize: "14px" }}>{item.icon}</span>
              {!collapsed && (
                <>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.badge != null && (
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "1px 7px",
                        borderRadius: "999px",
                        background: "var(--color-danger-soft)",
                        color: "var(--color-danger)",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </Link>
          )
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {!collapsed && (
        <div
          style={{
            padding: "12px",
            borderTop: "0.5px solid var(--color-border-tertiary)",
            fontSize: "10px",
            color: "var(--color-text-muted)",
          }}
        >
          <div style={{ marginBottom: "2px" }}>Press <kbd style={kbdStyle}>⌘</kbd>+<kbd style={kbdStyle}>K</kbd> for search</div>
          <div>or <kbd style={kbdStyle}>Ctrl</kbd>+<kbd style={kbdStyle}>K</kbd> on Windows</div>
        </div>
      )}
    </aside>
  )
}

const kbdStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: "9px",
  padding: "1px 5px",
  background: "var(--color-background-tertiary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: "3px",
}
