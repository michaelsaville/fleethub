// Human-friendly renderers for the raw values on InventorySnapshot.
// Single source of truth so /devices/[id], /clients/[name], and the
// PDF reports all read the same way.
//
// Raw quirks the formatters smooth over:
//   * agent reports RAM as float GB (`63.640872955322266`) → "64 GB"
//   * disks above 1024 GB shown as TB ("1.8 TB" / "1.7 TB free")
//   * `purchaseDate: "1970-01-01"` is the agent's "unknown" sentinel
//   * Windows software samples often duplicate the version inside the
//     name string ("7-Zip 26.00 (x64) 26.00") — collapse it.

const UNKNOWN = "—"

/** Round a float GB value and render with TB rollover at 1024. Never
 *  inflates `0.4 GB` to `0 GB` — anything > 0 but < 1 reads as `<1 GB`. */
export function formatGb(gb: number | null | undefined): string {
  if (gb == null || !Number.isFinite(gb)) return UNKNOWN
  if (gb <= 0) return UNKNOWN
  if (gb < 1) return "<1 GB"
  if (gb >= 1024) {
    const tb = gb / 1024
    return `${tb.toFixed(tb >= 10 ? 0 : 1)} TB`
  }
  return `${Math.round(gb)} GB`
}

/** Disk capacity readout: "157 GB free of 519 GB" or "1.7 TB free of 1.8 TB". */
export function formatDisk(freeGb: number, totalGb: number): string {
  return `${formatGb(freeGb)} free of ${formatGb(totalGb)}`
}

/** Render the agent's purchaseDate, hiding the Unix-epoch sentinel that
 *  every Windows agent ships when the value is unknown. Accepts ISO
 *  strings + `"YYYY-MM-DD"` shorthand. */
export function formatPurchaseDate(s: string | null | undefined): string {
  if (!s) return UNKNOWN
  // The agent's "unknown" sentinel is the Unix epoch; treat anything
  // before 1990 as unknown to also catch dirty CMOS rows.
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return UNKNOWN
  if (d.getUTCFullYear() < 1990) return UNKNOWN
  return d.toISOString().slice(0, 10)
}

/** Whether the agent's purchaseDate is real (not the sentinel). Useful
 *  for "warranty expires" math + sorting by purchase age. */
export function isRealPurchaseDate(s: string | null | undefined): boolean {
  if (!s) return false
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return false
  return d.getUTCFullYear() >= 1990
}

/** Windows DisplayName often includes the version suffix that's also
 *  in DisplayVersion, so we get `"7-Zip 26.00 (x64) 26.00"`. Detect a
 *  repeated trailing token that already appears earlier in the name. */
export function normalizeSoftwareName(name: string): string {
  if (!name) return name
  const trimmed = name.replace(/\s+/g, " ").trim()
  // Final token (typically a version like 26.00 or 9.4.1). If that token
  // already appears earlier in the string, drop it.
  const m = trimmed.match(/^(.*?)\s+(\S+)$/)
  if (!m) return trimmed
  const [, head, tail] = m
  if (head.includes(tail)) return head.trimEnd()
  return trimmed
}

/** RAM utilization as a Math.round'd integer percent. NaN / null → null
 *  so the caller can fall back to a "—" cell rather than rendering NaN. */
export function formatPctInt(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null
  return Math.round(pct)
}
