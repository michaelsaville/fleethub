import { z } from "zod"

// Phase 10 WS-B §4.3 — zod schema + safeParse for
// Fl_DeviceGroup.pinnedDeviceIdsJson. Just an array of cuid-ish
// strings. Read-side guard: if a row is hand-edited or arrives
// from a pre-validator migration, we want a malformed-row audit
// instead of a group that silently resolves to zero devices.

const CuidLike = z
  .string()
  .min(8, "device id looks too short")
  .max(64, "device id looks too long")

export const PinnedDeviceIds = z.array(CuidLike).max(5000, "max 5000 pinned device ids per group")

export type PinnedDeviceIds = z.infer<typeof PinnedDeviceIds>

export type SafeParsePinnedResult =
  | { ok: true; deviceIds: PinnedDeviceIds }
  | { ok: false; reason: string }

export function safeParsePinnedDeviceIdsJson(json: string): SafeParsePinnedResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = PinnedDeviceIds.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `pinnedDeviceIds shape mismatch: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    }
  }
  return { ok: true, deviceIds: parsed.data }
}
