/**
 * Standalone (non-server-only) time helpers for the devices UI. Lives
 * outside `lib/devices.ts` so client components can import it without
 * pulling in the prisma-bound server module.
 */

export function relativeLastSeen(d: Date | null): string {
  if (!d) return "never"
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toISOString().slice(0, 10)
}
