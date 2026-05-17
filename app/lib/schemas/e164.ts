import { z } from "zod"

// Phase 8 Workstream C §5.3 — E.164 phone atom. Pattern:
// leading "+", country digit 1-9, 6-14 more digits. Matches the
// staff-editor regex and the alert-route-validate regex; identical
// semantics, one definition.

const E164_RE = /^\+[1-9]\d{6,14}$/

export const E164 = z
  .string()
  .trim()
  .refine((s) => E164_RE.test(s), 'phone must be E.164 format (e.g. "+14155551234")')

export type E164 = z.infer<typeof E164>
