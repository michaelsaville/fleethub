import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"

// Phase v1.0.2 WS-D — serves the currently published agent
// version as text/plain. Used by:
//   - The bootstrap scripts to decide whether to upgrade.
//   - A future in-FH "your devices are out of date" widget.
//
// Read from /var/lib/fleethub/agent-releases/CURRENT (a tiny file
// containing just "v1.0.0\n"). Falls back to "v1.0.0" if the file
// is missing so a fresh deploy still answers the route.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const RELEASES_ROOT =
  process.env.FLEETHUB_AGENT_RELEASES_DIR ||
  "/var/lib/fleethub/agent-releases"
const FALLBACK = "v1.0.0"

export async function GET() {
  let version = FALLBACK
  try {
    const raw = await fs.readFile(path.join(RELEASES_ROOT, "CURRENT"), "utf8")
    const trimmed = raw.trim()
    if (trimmed) version = trimmed
  } catch {
    // file missing or unreadable → fallback
  }
  return new NextResponse(version + "\n", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
