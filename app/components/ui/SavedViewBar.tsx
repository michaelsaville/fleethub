"use client"
import { useEffect, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Chip } from "@/components/ui/Chip"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 12 WS-D.4 — saved-views row above /alerts + /devices filter
// bars. Renders one Chip interactive per view + a trailing "+ save
// current as…" button. Click a view → router.push with that view's
// filters. Save button persists current searchParams under a name.

interface SavedView {
  id: string
  name: string
  page: "alerts" | "devices"
  filters: Record<string, string>
  columnOrder?: string[]
  columnVis?: Record<string, boolean>
  sort?: { col: string; dir: "asc" | "desc" }
}

interface Props {
  page: "alerts" | "devices"
}

export function SavedViewBar({ page }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [views, setViews] = useState<SavedView[]>([])
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newName, setNewName] = useState("")
  const [err, setErr] = useState<string | null>(null)

  // Load on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/account/saved-views")
        if (!res.ok) return
        const data = (await res.json()) as { v: number; views: SavedView[] }
        if (cancelled) return
        setViews(data.views.filter((v) => v.page === page))
      } catch {
        // ignore — non-fatal
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page])

  // Determine which view (if any) the current URL matches by filter set.
  const currentFilters = Object.fromEntries(searchParams.entries())
  const activeViewId = views.find((v) => sameFilters(v.filters, currentFilters))?.id

  function activate(view: SavedView) {
    const sp = new URLSearchParams(view.filters)
    startTransition(() => router.push(`?${sp.toString()}`))
  }

  async function saveCurrent() {
    setErr(null)
    if (!newName.trim()) {
      setErr("name required")
      return
    }
    const view: SavedView = {
      id: `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: newName.trim(),
      page,
      filters: currentFilters,
    }
    const res = await fetch("/api/account/saved-views", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ view }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setErr(j.error ?? `HTTP ${res.status}`)
      return
    }
    setViews((prev) => [...prev, view])
    setShowSaveForm(false)
    setNewName("")
  }

  async function deleteView(id: string) {
    setErr(null)
    const res = await fetch(`/api/account/saved-views/${id}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setErr(j.error ?? `HTTP ${res.status}`)
      return
    }
    setViews((prev) => prev.filter((v) => v.id !== id))
  }

  if (views.length === 0 && !showSaveForm) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...TYPOGRAPHY.LABEL_CAPS, fontSize: 10.5 }}>Saved views</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setShowSaveForm(true)}
          disabled={Object.keys(currentFilters).length === 0}
          title={
            Object.keys(currentFilters).length === 0
              ? "Apply some filters first"
              : "Save current filters as a view"
          }
        >
          + save current as…
        </Button>
      </div>
    )
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {err && <InlineAlert tone="danger">{err}</InlineAlert>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ ...TYPOGRAPHY.LABEL_CAPS, fontSize: 10.5 }}>Saved views</span>
        {views.map((v) => (
          <Chip
            key={v.id}
            tone="accent"
            interactive
            active={activeViewId === v.id}
            onClick={() => activate(v)}
            title={`${Object.keys(v.filters).length} filters`}
          >
            {v.name}
          </Chip>
        ))}
        {!showSaveForm ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowSaveForm(true)}
            disabled={pending}
          >
            + save current as…
          </Button>
        ) : (
          <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="view name"
              style={{ ...FIELD, width: 160, fontSize: 11 }}
              autoFocus
            />
            <Button variant="primary" size="xs" onClick={saveCurrent} disabled={pending}>
              save
            </Button>
            <Button variant="ghost" size="xs" onClick={() => { setShowSaveForm(false); setNewName("") }} disabled={pending}>
              cancel
            </Button>
          </div>
        )}
        {activeViewId && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => deleteView(activeViewId)}
            disabled={pending}
            title="Delete the active view"
          >
            🗑 delete
          </Button>
        )}
      </div>
    </div>
  )
}

function sameFilters(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  if (ak.length !== bk.length) return false
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false
    if (a[ak[i]] !== b[bk[i]]) return false
  }
  return true
}
