import { z } from "zod"

// Phase 8 Workstream C §5.3 — email address atom. Strict-mode
// pattern matches what alert-route-validate has shipped since
// Phase 7 WS-A step 1; same regex, single source of truth.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const EmailAddress = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .refine((s) => EMAIL_RE.test(s), "not a valid email address")

export type EmailAddress = z.infer<typeof EmailAddress>
