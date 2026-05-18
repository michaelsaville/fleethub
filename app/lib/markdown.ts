// Phase 10 WS-C §5.6 — markdown rendering for Fl_DeviceNote /
// Fl_TenantNote.
//
// Pipeline: marked → DOMPurify (isomorphic). Same render path
// server + client (Phase 11 WS-E.3 — closes the SSR/CSR FOUC).
//
// Phase 11 WS-E.4 hardening:
//   - ALLOWED_URI_REGEXP explicit: http/https/mailto/anchor only.
//     Blocks data:, javascript:, vbscript:, file:, etc.
//   - afterSanitizeAttributes hook autoinjects rel="noopener
//     noreferrer" on every <a>. Prevents reverse-tabnabbing.

import { marked } from "marked"
import DOMPurify from "isomorphic-dompurify"

marked.use({
  gfm: false,
  breaks: true,
})

// One-time hook install. isomorphic-dompurify exposes addHook
// only on the resolved DOMPurify instance. Safe to call multiple
// times — DOMPurify dedupes hook callbacks by reference.
let hookInstalled = false
function ensureHook() {
  if (hookInstalled) return
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const el = node as Element
      el.setAttribute("rel", "noopener noreferrer")
      // Open external in new tab; in-page anchors keep default.
      const href = el.getAttribute("href") ?? ""
      if (href && !href.startsWith("#")) {
        el.setAttribute("target", "_blank")
      }
    }
  })
  hookInstalled = true
}

export function renderMarkdownSafe(body: string): string {
  if (!body) return ""
  ensureHook()
  const html = marked.parse(body, { async: false }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "a", "p", "br", "strong", "em", "code", "pre",
      "ul", "ol", "li", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "hr",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    ALLOW_DATA_ATTR: false,
    // Phase 11 WS-E.4 — explicit URI allowlist. Blocks data:,
    // javascript:, vbscript:, file:, ws:, ftp:, etc. # for
    // in-page anchor links.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  })
}

/// Server-side plain-text fallback. Used by callers that want a
/// preview line (e.g. /devices table) without the full HTML
/// rendering surface.
export function plainTextPreview(body: string, maxChars = 280): string {
  if (!body) return ""
  const stripped = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>]+\s*/g, "")
    .trim()
  return stripped.length > maxChars ? stripped.slice(0, maxChars - 1) + "…" : stripped
}
