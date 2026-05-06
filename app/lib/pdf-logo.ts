import "server-only"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { UPLOADS_DIR } from "@/lib/uploads"

// Resolves a Fl_Tenant.reportLogoUrl value into something @react-pdf/renderer's
// <Image> component can render server-side without HTTP-fetching the URL.
// Returns null on any failure so the PDF still renders (logo is decorative).
//
// URLs in the DB look like /api/uploads/tenant-logos/<filename>. We extract
// the filename and read directly from UPLOADS_DIR (/tmp/fleethub-uploads).
//
// @react-pdf/renderer accepts Buffer for src — that's what we return.

const LOGO_PREFIX = "/api/uploads/tenant-logos/"

export async function resolveLogoBuffer(
  url: string | null | undefined,
): Promise<Buffer | null> {
  if (!url) return null
  if (!url.startsWith(LOGO_PREFIX)) {
    // Externally hosted logos pass through unchanged — @react-pdf will
    // fetch them. We only intercept FleetHub-uploaded assets.
    return null
  }
  const filename = url.slice(LOGO_PREFIX.length)
  // Path-traversal guard.
  if (!filename || filename.includes("/") || filename.includes("..")) return null
  try {
    return await readFile(join(UPLOADS_DIR, "tenant-logos", filename))
  } catch (err) {
    console.warn("[pdf-logo] failed to read", filename, err)
    return null
  }
}
