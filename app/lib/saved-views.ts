import "server-only"
import { z } from "zod"

// Phase 12 WS-D.4 — saved-views shape.
//
// Persisted on Fl_StaffUser.savedViewsJson (column exists since
// Phase 0; zero references in the codebase until this PR). Architect
// §3.9 footgun: ship the {v: 1} envelope FROM DAY ONE so a v2
// migration doesn't need a destructive read.
//
// Each view is a per-page snapshot of filter/sort/columns. Page is
// either "alerts" or "devices" in v1.

const SavedViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  page: z.enum(["alerts", "devices"]),
  filters: z.record(z.string(), z.string()),
  columnOrder: z.array(z.string()).optional(),
  columnVis: z.record(z.string(), z.boolean()).optional(),
  sort: z
    .object({
      col: z.string(),
      dir: z.enum(["asc", "desc"]),
    })
    .optional(),
})

export const SavedViewsEnvelope = z.object({
  v: z.literal(1),
  views: z.array(SavedViewSchema),
})

export type SavedView = z.infer<typeof SavedViewSchema>
export type SavedViewsEnvelopeType = z.infer<typeof SavedViewsEnvelope>

const EMPTY: SavedViewsEnvelopeType = { v: 1, views: [] }

/** Parse `Fl_StaffUser.savedViewsJson` into the typed envelope.
 *  Unknown version (or parse failure) returns empty + the caller
 *  is responsible for re-saving — destructive but documented. */
export function parseSavedViews(json: string | null): SavedViewsEnvelopeType {
  if (!json) return EMPTY
  try {
    const parsed = JSON.parse(json) as unknown
    const result = SavedViewsEnvelope.safeParse(parsed)
    if (!result.success) return EMPTY
    return result.data
  } catch {
    return EMPTY
  }
}

export function serializeSavedViews(env: SavedViewsEnvelopeType): string {
  return JSON.stringify(env)
}
