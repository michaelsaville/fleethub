"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

type ResultCategory = "Pages" | "Entities" | "Recent"

interface PaletteResult {
  id: string
  category: ResultCategory
  label: string
  hint?: string
  href: string
  icon?: string
}

interface SearchResponse {
  pages: PaletteResult[]
  entities: PaletteResult[]
  recent: PaletteResult[]
}

/**
 * Cmd-K command palette per UI-PATTERNS.md:
 *   1. Pages     — direct nav to top-level surfaces (typed match)
 *   2. Entities  — fuzzy-matched devices, scripts, alerts
 *   3. Recent    — your last few audit-log actions
 *
 * Phase 0 ships Pages + Entities + Recent only — no Commands category
 * until the agent lands and we have actual executable verbs ("patch
 * now", "run script") to surface. Better empty than aspirational.
 *
 * Keyboard:
 *   ⌘K / Ctrl+K  open
 *   ↑ / ↓        navigate
 *   ENTER        select
 *   ESC          close
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [results, setResults] = useState<SearchResponse>({ pages: [], entities: [], recent: [] })
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const router = useRouter()

  // ⌘K / Ctrl+K toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Debounce: 120ms feels snappy without spamming the DB on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 120)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    setLoading(true)
    fetch(`/api/palette/search?q=${encodeURIComponent(debouncedQuery)}`, {
      signal: ac.signal,
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: SearchResponse) => {
        setResults(data)
        setActiveIndex(0)
      })
      .catch((e) => {
        if ((e as { name?: string }).name !== "AbortError") {
          setResults({ pages: [], entities: [], recent: [] })
        }
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [open, debouncedQuery])

  const grouped = useMemo(() => {
    const order: ResultCategory[] = ["Pages", "Entities", "Recent"]
    return order
      .map((cat) => ({
        category: cat,
        items:
          cat === "Pages"    ? results.pages :
          cat === "Entities" ? results.entities :
                               results.recent,
      }))
      .filter((g) => g.items.length > 0)
  }, [results])

  const flat = grouped.flatMap((g) => g.items)

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const pick = flat[activeIndex]
      if (pick) {
        router.push(pick.href)
        setOpen(false)
      }
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
        onClick={(e) => e.stopPropagation()}
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
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page or search devices, scripts, alerts…"
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
              {loading
                ? "Searching…"
                : query.trim()
                ? "No matches."
                : "Type to search · or press ESC to close"}
            </div>
          ) : (
            grouped.map((group) => (
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
                {group.items.map((item) => {
                  const idx = flat.indexOf(item)
                  const active = idx === activeIndex
                  return (
                    <button
                      key={item.id}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => {
                        router.push(item.href)
                        setOpen(false)
                      }}
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
                      {active && <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>↵</span>}
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
          <div>{loading ? "Searching…" : `${flat.length} result${flat.length === 1 ? "" : "s"}`}</div>
          <div>esc to close</div>
        </div>
      </div>
    </div>
  )
}
