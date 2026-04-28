"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

type ResultCategory = "Commands" | "Entities" | "Recent"

interface PaletteResult {
  id: string
  category: ResultCategory
  label: string
  hint?: string
  href: string
  icon?: string
}

/**
 * Cmd-K command palette per UI-PATTERNS.md:
 *   1. Commands  — verb-led ("reset password sarah", "patch now host01")
 *   2. Entities  — fuzzy-matched devices, clients, scripts, alerts
 *   3. Recent    — last 5 things you opened
 *
 * Phase 0 ships with mock data so the UX can be validated before any
 * backend wiring lands. Phase 1 swaps the in-memory MOCK_RESULTS for
 * a /api/palette/search?q=... endpoint that hits Postgres + the audit
 * log for "recent."
 *
 * Keyboard:
 *   ⌘K / Ctrl+K  open
 *   ↑ / ↓        navigate
 *   ENTER        select (executes command or navigates to entity)
 *   ESC          close
 */
const MOCK_RESULTS: PaletteResult[] = [
  // Commands — verb-led, executable
  { id: "c-1", category: "Commands", label: "Reset password — Sarah Smith",      hint: "acme · M365 user",     href: "/clients/acme/users?action=reset&u=sarah", icon: "🔑" },
  { id: "c-2", category: "Commands", label: "Patch now — acme-dc01",              hint: "Windows Server 2022", href: "/devices/acme-dc01?action=patch",          icon: "🩹" },
  { id: "c-3", category: "Commands", label: "Run script CleanTempFiles on Acme",  hint: "47 hosts targeted",   href: "/scripts/clean-temp/run?fleet=acme",       icon: "⚡" },
  { id: "c-4", category: "Commands", label: "Open RDP — msaville-laptop",         hint: "1-click remote",      href: "/devices/msaville-laptop?action=remote",   icon: "🖥" },
  // Entities — fuzzy-matched
  { id: "e-1", category: "Entities", label: "msaville-laptop",   hint: "device · acme · online", href: "/devices/msaville-laptop", icon: "💻" },
  { id: "e-2", category: "Entities", label: "acme-dc01",         hint: "device · acme · online", href: "/devices/acme-dc01",       icon: "💻" },
  { id: "e-3", category: "Entities", label: "Acme Corp",         hint: "client · 47 devices",    href: "/clients/acme",            icon: "🏢" },
  { id: "e-4", category: "Entities", label: "CleanTempFiles.ps1", hint: "script · curated",      href: "/scripts/clean-temp",      icon: "⚡" },
  // Recent — most recently opened
  { id: "r-1", category: "Recent",   label: "Disk space alert — acme-dc01", hint: "10m ago",          href: "/alerts/r-1", icon: "🔔" },
  { id: "r-2", category: "Recent",   label: "Patch deployment — May 2026",   hint: "1h ago",           href: "/patches/may-2026", icon: "🩹" },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const router = useRouter()

  // ⌘K / Ctrl+K toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return MOCK_RESULTS
    const q = query.toLowerCase()
    return MOCK_RESULTS.filter(
      r => r.label.toLowerCase().includes(q) || (r.hint?.toLowerCase().includes(q) ?? false),
    )
  }, [query])

  const grouped = useMemo(() => {
    const groups: Record<ResultCategory, PaletteResult[]> = { Commands: [], Entities: [], Recent: [] }
    for (const r of filtered) groups[r.category].push(r)
    return (["Commands", "Entities", "Recent"] as const)
      .filter(cat => groups[cat].length > 0)
      .map(cat => ({ category: cat, items: groups[cat] }))
  }, [filtered])

  const flat = grouped.flatMap(g => g.items)

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, flat.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)) }
    else if (e.key === "Enter") {
      e.preventDefault()
      const pick = flat[activeIndex]
      if (pick) { router.push(pick.href); setOpen(false) }
    }
  }

  if (!open) return null

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(640px, 92vw)",
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "12px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(0) }}
            onKeyDown={onKeyDown}
            placeholder="Search devices, clients, scripts — or type a command…"
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: "15px",
              color: "var(--color-text-primary)",
              fontFamily: "inherit",
            }}
          />
        </div>
        <div style={{ maxHeight: "400px", overflowY: "auto", padding: "8px 0" }}>
          {grouped.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "12px" }}>
              No results.
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.category}>
                <div
                  style={{
                    padding: "6px 16px 4px",
                    fontSize: "10px",
                    color: "var(--color-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    fontWeight: 600,
                  }}
                >
                  {group.category}
                </div>
                {group.items.map(item => {
                  const idx = flat.indexOf(item)
                  const active = idx === activeIndex
                  return (
                    <button
                      key={item.id}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => { router.push(item.href); setOpen(false) }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 16px",
                        background: active ? "var(--color-accent-soft)" : "transparent",
                        border: "none",
                        borderLeft: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                        cursor: "pointer",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      <span style={{ fontSize: "14px" }}>{item.icon ?? "•"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {item.label}
                        </div>
                        {item.hint && (
                          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.hint}
                          </div>
                        )}
                      </div>
                      {active && (
                        <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>↵</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 16px",
            borderTop: "0.5px solid var(--color-border-tertiary)",
            fontSize: "10px",
            color: "var(--color-text-muted)",
          }}
        >
          <div>Phase 0 stub · MOCK_RESULTS — Phase 1 hooks the real search backend</div>
          <div>esc to close</div>
        </div>
      </div>
    </div>
  )
}
