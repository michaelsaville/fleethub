"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type {
  DeviceViewRow,
  ViewFilters,
  ViewSort,
} from "@/lib/device-view-types"
import {
  createDeviceView,
  deleteDeviceView,
  reorderDeviceViews,
  setDefaultDeviceView,
  updateDeviceView,
} from "@/lib/device-views"

/**
 * Wave B — saved-view picker on /devices. Mirrors TicketHub's
 * ViewSelector visual pattern (pills grouped by visibility), but
 * without drag-to-reorder yet — @dnd-kit isn't in FH. The
 * reorderDeviceViews server action is in place for a later add.
 */
export function ViewSelector({
  views,
  defaultViewId,
  activeViewId,
  currentFilters,
  currentSort,
  isAdmin,
}: {
  views: DeviceViewRow[]
  defaultViewId: string | null
  activeViewId: string | null
  currentFilters: ViewFilters
  currentSort: ViewSort | null
  isAdmin: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [showSave, setShowSave] = useState(false)
  const [showMenu, setShowMenu] = useState<string | null>(null)
  const [saveName, setSaveName] = useState("")
  const [saveVisibility, setSaveVisibility] = useState<"PERSONAL" | "SHARED">("PERSONAL")
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(null)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  // Local optimistic order overrides — reset when the server views change.
  const [personalOrder, setPersonalOrder] = useState<string[] | null>(null)
  const [sharedOrder, setSharedOrder] = useState<string[] | null>(null)
  useEffect(() => {
    setPersonalOrder(null)
    setSharedOrder(null)
  }, [views])

  const grouped = useMemo(() => {
    const sys = views.filter((v) => v.visibility === "SYSTEM")
    const sharedRaw = views.filter((v) => v.visibility === "SHARED")
    const personalRaw = views.filter((v) => v.visibility === "PERSONAL")
    function applyOrder(list: DeviceViewRow[], override: string[] | null) {
      if (!override) return list
      const map = new Map(list.map((v) => [v.id, v]))
      return override
        .map((id) => map.get(id))
        .filter((v): v is DeviceViewRow => v != null)
    }
    return {
      sys,
      shared: applyOrder(sharedRaw, sharedOrder),
      personal: applyOrder(personalRaw, personalOrder),
    }
  }, [views, personalOrder, sharedOrder])

  // 8px activation distance — keeps click-to-select working alongside
  // drag-to-reorder. Below the threshold = click; above = drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  function makeReorderHandler(
    visibility: "PERSONAL" | "SHARED",
    list: DeviceViewRow[],
    setLocal: (ids: string[]) => void,
  ) {
    return async (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const oldIdx = list.findIndex((v) => v.id === active.id)
      const newIdx = list.findIndex((v) => v.id === over.id)
      if (oldIdx === -1 || newIdx === -1) return
      const next = arrayMove(list, oldIdx, newIdx).map((v) => v.id)
      setLocal(next)
      try {
        const r = await reorderDeviceViews({ visibility, orderedIds: next })
        if (!r.ok) {
          alert(r.error)
          setLocal([]) // clear override so next render shows server truth
        }
      } catch (err: unknown) {
        alert((err as Error)?.message ?? "Failed to save view order")
        setLocal([])
      }
    }
  }

  function switchToView(viewId: string | null) {
    const next = new URLSearchParams(params.toString())
    // Clear all overlay filter params + sort when switching views.
    // The view itself defines the filter+sort; overlays should NOT
    // bleed across view switches.
    for (const key of ["q", "client", "os", "online", "role", "hasAlerts", "maintenance", "enrolled", "sort", "sortField", "sortDir"]) {
      next.delete(key)
    }
    if (viewId) next.set("view", viewId)
    else next.delete("view")
    router.push(`/devices${next.toString() ? `?${next}` : ""}`)
  }

  async function saveCurrent() {
    if (!saveName.trim() || saving) return
    setSaving(true)
    try {
      const view = await createDeviceView({
        name: saveName.trim(),
        filters: currentFilters,
        sort: currentSort,
        visibility: saveVisibility,
      })
      setShowSave(false)
      setSaveName("")
      // Switch to the new view immediately.
      const next = new URLSearchParams()
      next.set("view", view.id)
      router.push(`/devices?${next}`)
    } finally {
      setSaving(false)
    }
  }

  async function setDefault(viewId: string) {
    await setDefaultDeviceView(viewId)
    setShowMenu(null)
    router.refresh()
  }

  async function remove(viewId: string) {
    if (!confirm("Delete this view? This cannot be undone.")) return
    await deleteDeviceView(viewId)
    setShowMenu(null)
    if (activeViewId === viewId) {
      // Drop ?view= so the page re-resolves to default
      const next = new URLSearchParams(params.toString())
      next.delete("view")
      router.push(`/devices${next.toString() ? `?${next}` : ""}`)
    } else {
      router.refresh()
    }
  }

  async function rename(viewId: string) {
    const current = views.find((v) => v.id === viewId)
    const newName = prompt("Rename view:", current?.name ?? "")
    if (!newName || newName.trim() === current?.name) return
    await updateDeviceView(viewId, { name: newName.trim() })
    setShowMenu(null)
    router.refresh()
  }

  function renderPillBody(v: DeviceViewRow, editable: boolean) {
    const active = v.id === activeViewId
    const isDefault = v.id === defaultViewId
    return (
      <>
        <button
          type="button"
          onClick={() => switchToView(v.id)}
          style={{
            ...pillStyle,
            ...(active ? pillActiveStyle : null),
          }}
          title={isDefault ? `${v.name} (default)` : v.name}
        >
          {v.icon && <span style={{ marginRight: 5 }}>{v.icon}</span>}
          {v.name}
          {isDefault && <span style={{ marginLeft: 6, color: "var(--color-warning)" }} aria-label="default">★</span>}
          {editable && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(showMenu === v.id ? null : v.id)
              }}
              onPointerDown={(e) => {
                // Keep the chevron immune from drag-activation.
                e.stopPropagation()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  e.stopPropagation()
                  setShowMenu(showMenu === v.id ? null : v.id)
                }
              }}
              style={menuChevronStyle}
              aria-label={`Open menu for ${v.name}`}
            >
              ⋯
            </span>
          )}
        </button>
        {showMenu === v.id && (
          <div ref={menuRef} style={popoverStyle}>
            {!isDefault && (
              <button type="button" onClick={() => setDefault(v.id)} style={popoverItemStyle}>
                Set as default
              </button>
            )}
            <button type="button" onClick={() => rename(v.id)} style={popoverItemStyle}>
              Rename…
            </button>
            <button
              type="button"
              onClick={() => remove(v.id)}
              style={{ ...popoverItemStyle, color: "var(--color-danger)" }}
            >
              Delete
            </button>
          </div>
        )}
      </>
    )
  }

  function renderSortableGroup(
    list: DeviceViewRow[],
    visibility: "PERSONAL" | "SHARED",
    setLocal: (ids: string[]) => void,
    canEdit: boolean,
  ) {
    if (!canEdit) {
      // Read-only group — render plain non-sortable spans.
      return list.map((v) => (
        <span key={v.id} style={{ position: "relative", display: "inline-flex" }}>
          {renderPillBody(v, false)}
        </span>
      ))
    }
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={makeReorderHandler(visibility, list, setLocal)}
      >
        <SortableContext
          items={list.map((v) => v.id)}
          strategy={horizontalListSortingStrategy}
        >
          {list.map((v) => (
            <SortablePill key={v.id} id={v.id}>
              {renderPillBody(v, true)}
            </SortablePill>
          ))}
        </SortableContext>
      </DndContext>
    )
  }

  const hasOverlay =
    !!params.get("q") ||
    !!params.get("client") ||
    !!params.get("os") ||
    !!params.get("online") ||
    !!params.get("role") ||
    !!params.get("hasAlerts") ||
    !!params.get("maintenance") ||
    !!params.get("enrolled") ||
    !!params.get("sort") ||
    !!params.get("sortField")

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
      {/* SYSTEM views — never editable, never sortable (admin-only via /admin). */}
      {grouped.sys.length > 0 && (
        <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {grouped.sys.map((v) => (
            <span key={v.id} style={{ position: "relative", display: "inline-flex" }}>
              {renderPillBody(v, false)}
            </span>
          ))}
        </div>
      )}
      {/* SHARED views — admin can edit + drag-reorder. */}
      {grouped.shared.length > 0 && (
        <>
          <Divider />
          <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {renderSortableGroup(grouped.shared, "SHARED", setSharedOrder, isAdmin)}
          </div>
        </>
      )}
      {/* PERSONAL views — owner edits + drag-reorder. */}
      {grouped.personal.length > 0 && (
        <>
          <Divider />
          <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {renderSortableGroup(grouped.personal, "PERSONAL", setPersonalOrder, true)}
          </div>
        </>
      )}
      {/* Save-as-view trigger — only enabled when filters/sort differ from the active view (overlay present). */}
      {hasOverlay && (
        <>
          <Divider />
          <button
            type="button"
            onClick={() => setShowSave(true)}
            style={{ ...pillStyle, borderStyle: "dashed", color: "var(--color-text-secondary)" }}
            title="Save the current filter + sort as a personal view"
          >
            + Save current as view…
          </button>
        </>
      )}

      {showSave && (
        <div style={modalBackdrop} onClick={() => setShowSave(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Save current filter as view</div>
            <input
              type="text"
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="View name (e.g. My Workstations)"
              maxLength={80}
              style={{
                width: "100%",
                padding: "7px 11px",
                fontSize: 13,
                background: "var(--color-background-secondary)",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: 6,
                color: "var(--color-text-primary)",
                marginBottom: 10,
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveCurrent()
                if (e.key === "Escape") setShowSave(false)
              }}
            />
            {isAdmin && (
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                <input
                  type="radio"
                  name="visibility"
                  checked={saveVisibility === "PERSONAL"}
                  onChange={() => setSaveVisibility("PERSONAL")}
                />
                Personal
                <input
                  type="radio"
                  name="visibility"
                  checked={saveVisibility === "SHARED"}
                  onChange={() => setSaveVisibility("SHARED")}
                  style={{ marginLeft: 8 }}
                />
                Shared (admin only)
              </label>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowSave(false)} style={ghostButton}>
                Cancel
              </button>
              <button type="button" onClick={saveCurrent} disabled={saving || !saveName.trim()} style={primaryButton}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Divider() {
  return (
    <span aria-hidden style={{ width: 1, height: 18, background: "var(--color-border-tertiary)", margin: "0 4px" }} />
  )
}

/** Draggable wrapper. Drag listeners attach to the whole pill — the
 *  chevron stops onPointerDown so clicks on it open the menu instead
 *  of starting a drag. */
function SortablePill({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  return (
    <span
      ref={setNodeRef}
      style={{
        position: "relative",
        display: "inline-flex",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        touchAction: "none",
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </span>
  )
}

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: "5px 11px",
  fontSize: 12,
  fontWeight: 500,
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: 999,
  color: "var(--color-text-secondary)",
  cursor: "pointer",
}
const pillActiveStyle: React.CSSProperties = {
  background: "var(--color-accent)",
  color: "#fff",
  borderColor: "var(--color-accent)",
}
const menuChevronStyle: React.CSSProperties = {
  marginLeft: 6,
  padding: "0 5px",
  borderRadius: 4,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
}
const popoverStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  zIndex: 10,
  display: "flex",
  flexDirection: "column",
  background: "var(--color-background-secondary)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: 6,
  padding: 4,
  minWidth: 160,
  boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
}
const popoverItemStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  fontSize: 12,
  background: "transparent",
  border: "none",
  color: "var(--color-text-primary)",
  cursor: "pointer",
  borderRadius: 4,
}
const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 20,
}
const modalBox: React.CSSProperties = {
  background: "var(--color-background)",
  border: "0.5px solid var(--color-border-secondary)",
  borderRadius: 10,
  padding: 18,
  width: 380,
  maxWidth: "calc(100vw - 32px)",
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
}
const ghostButton: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 12px",
  borderRadius: 5,
  border: "0.5px solid var(--color-border-secondary)",
  background: "transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
}
const primaryButton: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 12px",
  borderRadius: 5,
  border: "0.5px solid var(--color-accent)",
  background: "var(--color-accent)",
  color: "#fff",
  cursor: "pointer",
}
