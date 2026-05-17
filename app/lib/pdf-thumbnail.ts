import "server-only"
import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import os from "node:os"
import { hmacHex, safeEqualHex } from "./hmac"

// Renders the first page of a PDF to a PNG via poppler's pdftoppm. Used by
// Phase 5 step 8 (Slack/Teams thumbnail delivery) — Slack/Teams Block Kit
// can only display images via public URL, so we render once, cache to
// REPORTS_DIR, and serve via the signed /api/reports/[id]/thumbnail route.
//
// poppler-utils is installed in the runner stage of fleethub/Dockerfile.

export interface ThumbnailOptions {
  /** Output DPI. 100 yields ~700px wide for letter-size PDF — enough for
   *  Slack/Teams card preview without bloating the file. */
  dpi?: number
}

/** Render the first page of a PDF to PNG bytes. Uses a temp dir so we
 *  don't have to deal with pdftoppm's "<prefix>-NN.png" suffixing. */
export async function renderFirstPagePng(
  pdfPath: string,
  opts: ThumbnailOptions = {},
): Promise<Buffer> {
  const dpi = opts.dpi ?? 100
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fleethub-thumb-"))
  const prefix = path.join(tmpDir, "page")

  try {
    await spawnP("pdftoppm", [
      "-png",
      "-f", "1",
      "-l", "1",
      "-r", String(dpi),
      pdfPath,
      prefix,
    ])
    // pdftoppm emits "<prefix>-1.png" (or "-01" if pages>=10) for the first
    // page. Pick whichever exists.
    const candidates = [`${prefix}-1.png`, `${prefix}-01.png`]
    let last: unknown = null
    for (const file of candidates) {
      try {
        return await fs.readFile(file)
      } catch (e) {
        last = e
      }
    }
    throw new Error(
      `pdftoppm produced no output (looked for ${candidates.join(", ")}): ${
        last instanceof Error ? last.message : String(last)
      }`,
    )
  } finally {
    // Best-effort cleanup; don't let cleanup error swallow a real failure.
    void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function spawnP(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr?.on("data", (d) => {
      stderr += d.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim() || "(no stderr)"}`))
    })
  })
}

// HMAC token gating for the public thumbnail route. Slack/Teams need a
// reachable URL; we don't want any random scraper enumerating report IDs.
// Token = first 16 hex chars of HMAC-SHA256(reportId, FLEETHUB_AGENT_SECRET).
// Stable per-report, no DB row, no expiry — same blast radius as the
// download route's bearer-secret path.

function hmacSecret(): string {
  const s = process.env.FLEETHUB_AGENT_SECRET
  if (!s) throw new Error("FLEETHUB_AGENT_SECRET not set")
  return s
}

export function thumbnailToken(reportId: string): string {
  return hmacHex(reportId, hmacSecret()).slice(0, 16)
}

export function verifyThumbnailToken(reportId: string, token: string): boolean {
  if (!token || token.length !== 16) return false
  let expected: string
  try {
    expected = thumbnailToken(reportId)
  } catch {
    return false
  }
  return safeEqualHex(expected, token)
}
