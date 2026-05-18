import AppShell from "@/components/AppShell"
import { SkeletonBar, SkeletonCard } from "@/components/ui/Skeleton"

// Phase 9 WS-E §7.3 — shared loading state for every protected
// page. Closes the blank-screen-with-sidebar problem on 47
// force-dynamic pages. Per-segment overrides land only where a
// more specific shape helps (e.g. devices/[id] could mock the
// tab nav). Next.js segment-loading inheritance picks this up
// automatically.

export default function Loading() {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SkeletonBar width="240px" height={22} />
          <SkeletonBar width="420px" height={13} />
        </div>
        <SkeletonCard rows={2} />
        <SkeletonCard rows={5} />
      </div>
    </AppShell>
  )
}
