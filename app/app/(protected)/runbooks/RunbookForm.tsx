"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { FIELD, TYPOGRAPHY, CARD } from "@/lib/ui-tokens"
import { Button } from "@/components/ui/Button"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { InlineAlert } from "@/components/ui/InlineAlert"

// Phase 7 Workstream B step 3 — shared wizard for create + edit.
// One form, four sections (Identity → Match → Script → Behavior)
// rendered top-to-bottom so the operator reads them in order
// without a multi-step state machine.

type Severity = "critical" | "warn" | "info"

export interface RunbookFormInput {
  id: string | null
  name: string
  description: string
  severity: Severity[]
  kindLike: string
  scriptId: string
  graceMin: number
  cooldownMin: number
  maxFiresPerHour: number
  maxConsecutiveFailures: number
  dryRunFirst: boolean
  dryRunPredicate: string
  isActive: boolean
}

export interface ScriptOption {
  id: string
  name: string
  shell: string
  category: string | null
  dryRunCapable: boolean
}

export default function RunbookForm({
  initial,
  scripts,
}: {
  initial: RunbookFormInput
  scripts: ScriptOption[]
}) {
  const router = useRouter()
  const isEdit = initial.id !== null
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [severity, setSeverity] = useState<Severity[]>(initial.severity)
  const [kindLike, setKindLike] = useState(initial.kindLike)
  const [scriptId, setScriptId] = useState(initial.scriptId)
  const [graceMin, setGraceMin] = useState(initial.graceMin)
  const [cooldownMin, setCooldownMin] = useState(initial.cooldownMin)
  const [maxFiresPerHour, setMaxFiresPerHour] = useState(initial.maxFiresPerHour)
  const [maxConsecutiveFailures, setMaxConsecutiveFailures] = useState(initial.maxConsecutiveFailures)
  const [dryRunFirst, setDryRunFirst] = useState(initial.dryRunFirst)
  const [dryRunPredicate, setDryRunPredicate] = useState(initial.dryRunPredicate)
  const [isActive, setIsActive] = useState(initial.isActive)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  function toggleSeverity(s: Severity) {
    setSeverity((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      match: {
        severity,
        kindLike: kindLike.trim() || undefined,
      },
      scriptId,
      graceMin,
      cooldownMin,
      maxFiresPerHour,
      maxConsecutiveFailures,
      dryRunFirst,
      dryRunPredicate: dryRunPredicate.trim() || undefined,
      isActive,
    }
    try {
      const url = isEdit ? `/api/admin/runbooks/${initial.id}` : `/api/admin/runbooks`
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
      const j = (await res.json().catch(() => ({}))) as { id?: string }
      const targetId = isEdit ? initial.id : j.id
      router.push(targetId ? `/runbooks/${targetId}` : "/runbooks")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!isEdit) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/runbooks/${initial.id}`, { method: "DELETE" })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `Delete failed (HTTP ${res.status})`)
        setDeleting(false)
        throw new Error(j.error ?? `Delete failed (HTTP ${res.status})`)
      }
      router.push("/runbooks")
      router.refresh()
    } catch (err) {
      setDeleting(false)
      throw err
    }
  }

  const selectedScript = scripts.find((s) => s.id === scriptId) ?? null

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <Section title="Identity">
        <Field label="Name" hint='Short, action-oriented. "Disk cleanup on disk.full"'>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="" style={{ ...FIELD, width: 380 }} />
        </Field>
        <Field label="Description" hint="Why does this runbook exist? What does success look like?">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...FIELD, width: "100%", resize: "vertical", fontFamily: "inherit" }} />
        </Field>
      </Section>

      <Section title="Match (when does this fire?)">
        <Field label="Severity" hint="When empty, an unbounded runbook would match every alert — we require at least one of severity or kind glob.">
          <div style={{ display: "flex", gap: 8 }}>
            {(["critical", "warn", "info"] as Severity[]).map((s) => (
              <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={severity.includes(s)} onChange={() => toggleSeverity(s)} />
                {s}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Kind glob" hint='Like "disk.*", "service.down", or "*" for any matching severity. Case-insensitive.'>
          <input type="text" value={kindLike} onChange={(e) => setKindLike(e.target.value)} placeholder="disk.*" style={{ ...FIELD, width: 320 }} />
        </Field>
      </Section>

      <Section title="Script (what runs?)">
        <Field label="Fl_Script" hint="Only signed + active scripts can be bound. Edit the script in /scripts to change its body.">
          <select value={scriptId} onChange={(e) => setScriptId(e.target.value)} style={{ ...FIELD, width: 380 }}>
            <option value="">(pick a script)</option>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.shell}{s.category ? ` · ${s.category}` : ""}{s.dryRunCapable ? " · dry-run capable" : ""}
              </option>
            ))}
          </select>
        </Field>
        {selectedScript && !selectedScript.dryRunCapable && dryRunFirst && (
          <div style={{ padding: "6px 10px", fontSize: 11.5, color: "var(--color-warning, #b45309)", background: "var(--color-warning-soft, rgba(234, 179, 8, 0.1))", borderRadius: 6 }}>
            <strong>Note:</strong> selected script isn&rsquo;t dry-run capable. Phase 2 forces dryRun=false at execution time regardless of the dryRunFirst flag below. Step 5&rsquo;s predicate flow will skip the dry-run pass and go straight to live execution for non-capable scripts.
          </div>
        )}
      </Section>

      <Section title="Behavior">
        <Field label="Grace (minutes)" hint="Wait this long after the alert fires before running. Lets transient alerts clear on their own.">
          <input type="number" min={0} max={1440} value={graceMin} onChange={(e) => setGraceMin(Number(e.target.value))} style={{ ...FIELD, width: 100 }} />
        </Field>
        <Field label="Cooldown (minutes)" hint="Per (alert kind, device). Skips fires within this window after a previous fire — keeps flapping alerts from blowing up the agent fleet.">
          <input type="number" min={0} max={1440} value={cooldownMin} onChange={(e) => setCooldownMin(Number(e.target.value))} style={{ ...FIELD, width: 100 }} />
        </Field>
        <Field label="Circuit breaker — max fires per hour" hint="Evaluator auto-trips the runbook if non-skipped fires in the last rolling hour reach this. Counts across all devices.">
          <input type="number" min={1} max={1000} value={maxFiresPerHour} onChange={(e) => setMaxFiresPerHour(Number(e.target.value))} style={{ ...FIELD, width: 100 }} />
        </Field>
        <Field label="Circuit breaker — max consecutive failures" hint="Watcher cron auto-trips after this many failed fires in a row (skipped fires don't count). Trips emit a routable runbook.tripped alert.">
          <input type="number" min={1} max={100} value={maxConsecutiveFailures} onChange={(e) => setMaxConsecutiveFailures(Number(e.target.value))} style={{ ...FIELD, width: 100 }} />
        </Field>
      </Section>

      <Section title="Dry-run first (step 5 wires this)">
        <Field label="Run a dry-run first?" hint="When yes (and the script is dry-run capable), the agent runs with --dry-run, the predicate below decides whether to proceed live. Step 5 implements the predicate evaluator; step 3 just persists the flag + predicate.">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={dryRunFirst} onChange={(e) => setDryRunFirst(e.target.checked)} />
            yes
          </label>
        </Field>
        <Field label="Dry-run predicate (JSON, optional)" hint='Step 5 will support shapes like {"stdoutContains": "would free"} or {"exitCode": 0}. Step 3 just validates the JSON parses.'>
          <textarea value={dryRunPredicate} onChange={(e) => setDryRunPredicate(e.target.value)} placeholder='{"stdoutContains": "would free"}' rows={3} style={{ ...FIELD, width: "100%", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, resize: "vertical" }} />
        </Field>
      </Section>

      <Section title="Active">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active (evaluator considers this runbook on every alert)
        </label>
      </Section>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {isEdit && (
          <Button
            type="button"
            variant="danger"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleting || submitting}
            style={{ marginRight: "auto", background: "transparent", color: "var(--color-danger)", border: "0.5px solid var(--color-danger)" }}
          >
            {deleting ? "Deleting…" : "Delete runbook"}
          </Button>
        )}
        <ConfirmModal
          open={deleteConfirmOpen}
          onClose={() => setDeleteConfirmOpen(false)}
          onConfirm={onDelete}
          title="Delete this runbook?"
          body="Fire history is cascade-deleted with it. Use Disable instead if you want to keep the history."
          confirmLabel="Delete runbook"
          tone="danger"
          typedName={{
            expected: name,
            prompt: `Type "${name}" to confirm:`,
          }}
        />
        <Link
          href={isEdit ? `/runbooks/${initial.id}` : "/runbooks"}
          style={{ padding: "8px 14px", fontSize: 13, color: "var(--color-text-secondary)", textDecoration: "none", borderRadius: "var(--radius-sm)" }}
        >
          Cancel
        </Link>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Create runbook"}
        </Button>
      </div>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...CARD, display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px" }}>
      <h2 style={TYPOGRAPHY.LABEL_CAPS}>{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-secondary)" }}>{label}</span>
      {children}
      {hint && <span style={TYPOGRAPHY.HINT}>{hint}</span>}
    </div>
  )
}
