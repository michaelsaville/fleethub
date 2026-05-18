import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

// Phase v1.0.2 WS-D — serves an agent manifest:
//   {
//     "version": "v1.0.0",
//     "platforms": {
//       "linux-amd64":   { "sha256": "...", "size": 5742744 },
//       "windows-amd64": { "sha256": "...", "size": 6099968 },
//       "darwin-amd64":  { "sha256": "...", "size": 6089040 }
//     }
//   }
//
// The bootstrap scripts can verify the downloaded binary against
// the sha256 here before chmod 0755 + mv into place. v1.0 is
// content-hash only — Phase v1.1 will add Ed25519-signed
// manifests (mirrors evidence-zip §11.5 in Phase 5).
//
// Manifest is computed live from on-disk binaries; missing
// platforms are simply omitted (no error). This keeps the route
// fault-tolerant during partial release uploads.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const RELEASES_ROOT =
  process.env.FLEETHUB_AGENT_RELEASES_DIR ||
  "/var/lib/fleethub/agent-releases"

// Maps the wire-platform name to the on-disk binary filename
// inside RELEASES_ROOT/<version>/.
const PLATFORM_FILES: Record<string, string> = {
  "linux-amd64": "pcc2k-agent",
  "windows-amd64": "pcc2k-agent.exe",
  "darwin-amd64": "pcc2k-agent-darwin",
}

async function currentVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(RELEASES_ROOT, "CURRENT"), "utf8")
    return raw.trim() || "v1.0.0"
  } catch {
    return "v1.0.0"
  }
}

async function hashFile(p: string): Promise<{ sha256: string; size: number } | null> {
  try {
    const buf = await fs.readFile(p)
    return {
      sha256: createHash("sha256").update(buf).digest("hex"),
      size: buf.length,
    }
  } catch {
    return null
  }
}

export async function GET() {
  const version = await currentVersion()
  const versionDir = path.join(RELEASES_ROOT, version)
  const platforms: Record<string, { sha256: string; size: number }> = {}
  for (const [name, file] of Object.entries(PLATFORM_FILES)) {
    const meta = await hashFile(path.join(versionDir, file))
    if (meta) platforms[name] = meta
  }
  return NextResponse.json(
    { version, platforms },
    { headers: { "cache-control": "no-store" } },
  )
}
