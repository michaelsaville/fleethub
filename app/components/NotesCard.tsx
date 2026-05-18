"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { FIELD, TYPOGRAPHY } from "@/lib/ui-tokens"
import { renderMarkdownSafe } from "@/lib/markdown"

// Phase 10 WS-C §5.6 — shared notes card for /devices/[id] and
// /clients/[name]. Pinned notes render at the top; reverse-chrono
// for the rest. Editor opens inline; delete is soft + confirmed.

interface NoteRow {
  id: string
  body: string
  isPinned: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

interface Props {
  scope: "device" | "tenant"
  scopeKey: string // deviceId or tenantName
  notes: NoteRow[]
  /// When true, the operator can create / edit / delete. Mirrors
  /// the page-level requireSession check; the API enforces it too.
  canEdit: boolean
}

export default function NotesCard({ scope, scopeKey, notes, canEdit }: Props) {
  const [drafting, setDrafting] = useState(false)
  const [draftBody, setDraftBody] = useState("")
  const [draftPinned, setDraftPinned] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState<NoteRow | null>(null)

  const apiBase = scope === "device" ? "/api/admin/device-notes" : "/api/admin/tenant-notes"
  const scopeField = scope === "device" ? "deviceId" : "tenantName"

  const sorted = [...notes].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    return b.createdAt.localeCompare(a.createdAt)
  })

  async function createNote() {
    setError(null)
    if (!draftBody.trim()) {
      setError("Body required")
      return
    }
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        [scopeField]: scopeKey,
        body: draftBody,
        isPinned: draftPinned,
      }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    setDrafting(false)
    setDraftBody("")
    setDraftPinned(false)
    startTransition(() => router.refresh())
  }

  async function deleteNote(id: string) {
    setError(null)
    const res = await fetch(`${apiBase}/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    setConfirmDelete(null)
    startTransition(() => router.refresh())
  }

  async function togglePin(note: NoteRow) {
    const res = await fetch(`${apiBase}/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPinned: !note.isPinned }),
    })
    if (res.ok) startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader
        title={`Notes · ${notes.length}`}
        action={
          canEdit && !drafting ? (
            <Button variant="secondary" size="sm" onClick={() => setDrafting(true)} disabled={pending}>
              + New note
            </Button>
          ) : null
        }
      />

      {drafting && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12, padding: 12, background: "var(--color-background-tertiary, rgba(148, 163, 184, 0.08))", borderRadius: 6 }}>
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={4}
            placeholder="Markdown — bold **like this**, code `inline`, links [name](url)"
            style={{ ...FIELD, width: "100%", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, resize: "vertical" }}
            autoFocus
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 11.5, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={draftPinned} onChange={(e) => setDraftPinned(e.target.checked)} />
              Pin to top
            </label>
            <div style={{ flex: 1 }} />
            <Button variant="ghost" size="sm" onClick={() => { setDrafting(false); setDraftBody(""); setError(null) }} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={createNote} disabled={pending}>
              Save note
            </Button>
          </div>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      )}

      {sorted.length === 0 && !drafting ? (
        <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
          No notes yet. Capture "the admin pw is in vault under acme-router-admin", "switch is in MDF closet", or any other operational context here.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((n) => (
            <li
              key={n.id}
              style={{
                padding: "10px 12px",
                background: n.isPinned ? "var(--color-warning-soft, rgba(202, 138, 4, 0.08))" : "var(--color-background-primary)",
                border: n.isPinned ? "0.5px solid var(--color-warning)" : "0.5px solid var(--color-border-tertiary)",
                borderRadius: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
                <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>{n.createdBy}</span>
                <span>{new Date(n.createdAt).toLocaleString()}</span>
                {n.updatedAt !== n.createdAt && <span>(edited)</span>}
                {n.isPinned && <span style={{ color: "var(--color-warning)", fontWeight: 600 }}>📌 pinned</span>}
                <div style={{ flex: 1 }} />
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => togglePin(n)}
                      disabled={pending}
                      style={iconBtn}
                      title={n.isPinned ? "Unpin" : "Pin"}
                    >
                      {n.isPinned ? "unpin" : "pin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(n)}
                      disabled={pending}
                      style={{ ...iconBtn, color: "var(--color-danger)" }}
                      title="Delete (soft)"
                    >
                      delete
                    </button>
                  </>
                )}
              </div>
              <NoteBody body={n.body} />
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await deleteNote(confirmDelete.id)
        }}
        title="Soft-delete this note?"
        body="Notes are soft-deleted (retained for audit) and hidden from the operator surface. There's no UI to undelete, but the row is preserved."
        confirmLabel="Delete"
        tone="danger"
      />
    </Card>
  )
}

function NoteBody({ body }: { body: string }) {
  // Server renders the raw markdown text; client hydrates with
  // sanitized HTML. Prevents an XSS surface if SSR ever bypassed
  // the sanitize pass.
  const html = typeof window !== "undefined" ? renderMarkdownSafe(body) : null
  if (html) {
    return (
      <div
        style={{ fontSize: 13, lineHeight: 1.55, color: "var(--color-text-primary)" }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return (
    <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--color-text-primary)", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
      {body}
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--color-text-muted)",
  fontSize: 10.5,
  padding: "1px 6px",
  borderRadius: 3,
  cursor: "pointer",
  textDecoration: "underline",
}
