import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"
import { tenantForEnrollKey } from "@/lib/agent-enroll"
import { renderKeyBootstrapPs1, renderKeyBootstrapSh } from "@/lib/install-scripts"

// Deploy-on-the-fly (2026-09-13). Everything a tech needs to add a
// machine to a client, behind one per-client key:
//
//   /install/k/<key>/pcc2k-agent.ps1          one-liner target (Windows)
//   /install/k/<key>/pcc2k-agent.sh           one-liner target (Linux/macOS)
//   /install/k/<key>/pcc2k-agent-<key>.exe    double-click installer —
//                                             the stock binary served under
//                                             a name that carries the key;
//                                             the agent reads it from its
//                                             own filename and self-installs
//                                             (no config baked into the
//                                             bytes, so a future Authenticode
//                                             signature survives).
//
// Unknown or disabled key → 404 for every file, so nothing leaks.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const RELEASES_ROOT =
  process.env.FLEETHUB_AGENT_RELEASES_DIR || "/var/lib/fleethub/agent-releases"

async function currentVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(RELEASES_ROOT, "CURRENT"), "utf8")
    return raw.trim() || "v1.0.0"
  } catch {
    return "v1.0.0"
  }
}

// The URL the TARGET machine must reach. Behind nginx the request's own
// host is the container's (0.0.0.0:3000) — served a script pointing there
// once, 2026-09-13, and the install died on the download. So: env, else
// the proxy's forwarded host, else the public hostname; never req.url.
function baseUrl(req: Request): string {
  const env = process.env.FLEETHUB_PUBLIC_URL?.trim()
  if (env) return env.replace(/\/$/, "")
  const fwdHost = req.headers.get("x-forwarded-host")?.split(",")[0].trim()
  if (fwdHost && !/^(0\.0\.0\.0|127\.|localhost)/.test(fwdHost)) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https"
    return `${proto}://${fwdHost}`
  }
  return "https://fleethub.pcc2k.com"
}

export async function GET(
  req: Request,
  context: { params: Promise<{ key: string; file: string }> },
) {
  const { key, file } = await context.params
  const tenant = await tenantForEnrollKey(key)
  if (!tenant) return new NextResponse("not found", { status: 404 })

  const url = baseUrl(req)
  const text = (body: string, name: string) =>
    new NextResponse(body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": `inline; filename="${name}"`,
      },
    })

  if (file === "pcc2k-agent.ps1") return text(renderKeyBootstrapPs1(url, key), file)
  if (file === "pcc2k-agent.sh") return text(renderKeyBootstrapSh(url, key), file)

  // Binary downloads. The filename the browser saves is what the agent
  // parses, so we only ever hand out `pcc2k-agent-<key>.exe`; any other
  // .exe name 404s rather than serving a binary that won't self-install.
  const isExe = file === `pcc2k-agent-${key}.exe`
  const isLinux = file === `pcc2k-agent-${key}`
  if (!isExe && !isLinux) return new NextResponse("not found", { status: 404 })

  const version = await currentVersion()
  const absPath = path.join(RELEASES_ROOT, version, isExe ? "pcc2k-agent.exe" : "pcc2k-agent")
  let buf: Buffer
  try {
    buf = await fs.readFile(absPath)
  } catch {
    return new NextResponse("binary not staged", { status: 503 })
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(buf.length),
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
      "x-pcc2k-agent-version": version,
      "x-pcc2k-tenant": tenant.name,
    },
  })
}
