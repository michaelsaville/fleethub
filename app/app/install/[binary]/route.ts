import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"

// Phase v1.0.2 WS-D — serves the platform binary so bootstrap
// scripts can curl /install/pcc2k-agent-linux-amd64 etc.
//
// Matches the same PLATFORM_FILES map as agent-manifest.json. We
// keep an allow-list rather than passing the slug straight to fs
// to avoid path traversal — `[binary]` is dynamic Next.js routing
// but we never let the client name an arbitrary file under
// RELEASES_ROOT.
//
// Response is the file stream; the script verifies sha256 from
// the manifest before installing.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const RELEASES_ROOT =
  process.env.FLEETHUB_AGENT_RELEASES_DIR ||
  "/var/lib/fleethub/agent-releases"

const BINARY_ALLOWLIST: Record<string, { file: string; contentType: string }> = {
  "pcc2k-agent-linux-amd64": {
    file: "pcc2k-agent",
    contentType: "application/octet-stream",
  },
  "pcc2k-agent-windows-amd64": {
    file: "pcc2k-agent.exe",
    contentType: "application/octet-stream",
  },
  // bootstrap.ps1 requests the .exe-suffixed name natively in
  // PowerShell — both forms resolve to the same file.
  "pcc2k-agent-windows-amd64.exe": {
    file: "pcc2k-agent.exe",
    contentType: "application/octet-stream",
  },
  "pcc2k-agent-darwin-amd64": {
    file: "pcc2k-agent-darwin",
    contentType: "application/octet-stream",
  },
  // The bootstrap.sh script also tries the un-arch'd shortcut
  // (pcc2k-agent-linux) for older operator muscle memory.
  "pcc2k-agent-linux": {
    file: "pcc2k-agent",
    contentType: "application/octet-stream",
  },
  "pcc2k-agent-windows": {
    file: "pcc2k-agent.exe",
    contentType: "application/octet-stream",
  },
}

async function currentVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(RELEASES_ROOT, "CURRENT"), "utf8")
    return raw.trim() || "v1.0.0"
  } catch {
    return "v1.0.0"
  }
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ binary: string }> },
) {
  const { binary } = await context.params
  const entry = BINARY_ALLOWLIST[binary]
  if (!entry) {
    return new NextResponse("not found", { status: 404 })
  }
  const version = await currentVersion()
  const absPath = path.join(RELEASES_ROOT, version, entry.file)
  let buf: Buffer
  try {
    buf = await fs.readFile(absPath)
  } catch {
    return new NextResponse("binary not provisioned on this server", {
      status: 503,
    })
  }
  // NextResponse wants BodyInit. Node Buffer / Uint8Array trip the
  // Next 16 + Node 22 type checker (narrowed BodyInit no longer
  // accepts a bare typed array). Blob wrap is the cleanest fix.
  const body = new Blob([new Uint8Array(buf)], { type: entry.contentType })
  return new NextResponse(body, {
    headers: {
      "content-type": entry.contentType,
      "content-length": String(buf.length),
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${entry.file}"`,
    },
  })
}
