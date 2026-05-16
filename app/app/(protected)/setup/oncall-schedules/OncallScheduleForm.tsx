"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FIELD_SM, TYPOGRAPHY, CARD } from "@/lib/ui-tokens"
import { Button } from "@/components/ui/Button"

// Phase 7 Workstream A step 8 — shared editor for on-call schedules.
// Rotation grid: pick a user + days + start/end (UTC HH:MM).
// Overrides: ad-hoc ISO-dated windows that beat the rotation.

interface RotationSlotDraft {
  userId: string
  dayOfWeek: number
  start: string
  end: string
}
interface OverrideDraft {
  userId: string
  start: string  // ISO
  end: string
  reason: string
}

export interface OncallScheduleFormInput {
  id: string | null
  name: string
  rotation: RotationSlotDraft[]
  overrides: OverrideDraft[]
  isActive: boolean
}

export interface StaffOption {
  id: string
  email: string
  name: string | null
  phoneE164: string | null
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

// FIELD_STYLE replaced by canonical FIELD_SM token (compact
// variant for dense oncall rotation rows) from @/lib/ui-tokens.
const FIELD_STYLE = FIELD_SM

export default function OncallScheduleForm({
  initial,
  staff,
}: {
  initial: OncallScheduleFormInput
  staff: StaffOption[]
}) {
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [rotation, setRotation] = useState<RotationSlotDraft[]>(initial.rotation)
  const [overrides, setOverrides] = useState<OverrideDraft[]>(initial.overrides)
  const [isActive, setIsActive] = useState(initial.isActive)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = initial.id !== null

  function addSlot() {
    setRotation((prev) => [
      ...prev,
      { userId: staff[0]?.id ?? "", dayOfWeek: 1, start: "09:00", end: "17:00" },
    ])
  }
  function updateSlot(i: number, patch: Partial<RotationSlotDraft>) {
    setRotation((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function removeSlot(i: number) {
    setRotation((prev) => prev.filter((_, idx) => idx !== i))
  }

  function addOverride() {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16)
    const dayAfter = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16)
    setOverrides((prev) => [
      ...prev,
      { userId: staff[0]?.id ?? "", start: tomorrow, end: dayAfter, reason: "" },
    ])
  }
  function updateOverride(i: number, patch: Partial<OverrideDraft>) {
    setOverrides((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  }
  function removeOverride(i: number) {
    setOverrides((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const body = {
      name: name.trim(),
      rotation,
      overrides: overrides.map((o) => ({
        userId: o.userId,
        // datetime-local lacks tz info; treat the value as UTC by
        // appending "Z". Matches the UTC-throughout design contract.
        start: o.start.length === 16 ? o.start + ":00Z" : o.start,
        end: o.end.length === 16 ? o.end + ":00Z" : o.end,
        reason: o.reason.trim() || null,
      })),
      isActive,
    }
    try {
      const url = isEdit ? `/api/admin/oncall-schedules/${initial.id}` : `/api/admin/oncall-schedules`
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Failed (HTTP ${res.status})`)
        setSubmitting(false)
        return
      }
      router.push("/setup/oncall-schedules")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!isEdit) return
    if (!confirm("Delete this schedule? Any alert-route channel that references it will start failing dispatch.")) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/oncall-schedules/${initial.id}`, { method: "DELETE" })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Delete failed (HTTP ${res.status})`)
        setDeleting(false)
        return
      }
      router.push("/setup/oncall-schedules")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setDeleting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Ops primary"' style={{ ...FIELD_STYLE, width: 320 }} />
      </Section>

      <Section title="Rotation (weekly, UTC)">
        {rotation.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            No slots yet — every dispatch will fail until rotation or override covers the moment.
          </span>
        )}
        {rotation.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: "var(--color-background-primary, #fff)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6 }}>
            <select value={s.userId} onChange={(e) => updateSlot(i, { userId: e.target.value })} style={{ ...FIELD_STYLE, width: 200 }}>
              <option value="">(pick a user)</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ? `${u.name} (${u.email})` : u.email}
                  {u.phoneE164 ? "" : " — no phone"}
                </option>
              ))}
            </select>
            <select value={s.dayOfWeek} onChange={(e) => updateSlot(i, { dayOfWeek: Number(e.target.value) })} style={{ ...FIELD_STYLE, width: 90 }}>
              {DAYS.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
            </select>
            <input type="time" value={s.start} onChange={(e) => updateSlot(i, { start: e.target.value })} style={{ ...FIELD_STYLE, width: 110 }} />
            <span style={{ fontSize: 12 }}>to</span>
            <input type="time" value={s.end} onChange={(e) => updateSlot(i, { end: e.target.value })} style={{ ...FIELD_STYLE, width: 110 }} />
            <button type="button" onClick={() => removeSlot(i)} style={{ marginLeft: "auto", padding: "3px 7px", fontSize: 11, color: "var(--color-text-muted)", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4, cursor: "pointer" }}>
              ✕
            </button>
          </div>
        ))}
        <div>
          <button type="button" onClick={addSlot} style={addBtn}>+ Add rotation slot</button>
        </div>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          Times are UTC. A slot like Mon 09:00–17:00 covers Mondays 09:00–17:00 UTC. Slots can wrap midnight (e.g. 20:00–04:00) — same calendar day, end-time treated as next-morning. First slot in the list wins on overlap.
        </span>
      </Section>

      <Section title="Overrides (ISO windows, UTC)">
        {overrides.map((o, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: "var(--color-background-primary, #fff)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, flexWrap: "wrap" }}>
            <select value={o.userId} onChange={(e) => updateOverride(i, { userId: e.target.value })} style={{ ...FIELD_STYLE, width: 200 }}>
              <option value="">(pick a user)</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
              ))}
            </select>
            <input type="datetime-local" value={o.start.slice(0, 16)} onChange={(e) => updateOverride(i, { start: e.target.value })} style={FIELD_STYLE} />
            <span style={{ fontSize: 12 }}>to</span>
            <input type="datetime-local" value={o.end.slice(0, 16)} onChange={(e) => updateOverride(i, { end: e.target.value })} style={FIELD_STYLE} />
            <input type="text" value={o.reason} onChange={(e) => updateOverride(i, { reason: e.target.value })} placeholder="reason (optional)" style={{ ...FIELD_STYLE, flex: 1, minWidth: 160 }} />
            <button type="button" onClick={() => removeOverride(i)} style={{ padding: "3px 7px", fontSize: 11, color: "var(--color-text-muted)", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4, cursor: "pointer" }}>
              ✕
            </button>
          </div>
        ))}
        <div>
          <button type="button" onClick={addOverride} style={addBtn}>+ Add override</button>
        </div>
      </Section>

      <Section title="Behavior">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active (alert channels resolve against this schedule)
        </label>
      </Section>

      {error && (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--color-danger, #b91c1c)", background: "var(--color-danger-soft, rgba(239, 68, 68, 0.1))", borderRadius: 6 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {isEdit && (
          <Button
            type="button"
            variant="danger"
            onClick={onDelete}
            disabled={deleting || submitting}
            style={{ marginRight: "auto", background: "transparent", color: "var(--color-danger)", border: "0.5px solid var(--color-danger)" }}
          >
            {deleting ? "Deleting…" : "Delete schedule"}
          </Button>
        )}
        <Link
          href="/setup/oncall-schedules"
          style={{ padding: "8px 14px", fontSize: 13, color: "var(--color-text-secondary)", textDecoration: "none", borderRadius: "var(--radius-sm)" }}
        >
          Cancel
        </Link>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Create schedule"}
        </Button>
      </div>
    </form>
  )
}

// Dashed "+ Add" button styled as a secondary-with-dashed-border —
// distinct from the solid Button variants so operators can tell
// "add row" from "submit form" at a glance.
const addBtn: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  background: "var(--color-background-secondary)",
  border: "0.5px dashed var(--color-border-tertiary)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...CARD, display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px" }}>
      <h2 style={TYPOGRAPHY.LABEL_CAPS}>{title}</h2>
      {children}
    </section>
  )
}
