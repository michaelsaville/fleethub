// Phase 10 WS-C §5.6 — markdown rendering for Fl_DeviceNote /
// Fl_TenantNote.
//
// Pipeline: marked → DOMPurify. Both run in the browser only —
// keeping the parse + sanitize on the client lets server pages
// stream the raw markdown without paying for the dep on every
// render. Server-side: we just escape + show plain text on
// JS-disabled clients.

import { marked } from "marked"
import DOMPurify from "dompurify"

// Configure marked once. v1 surface: bold, links, lists, code,
// inline-code, headings. Tables + task-lists land in v1.5 if
// asked. mangle/headerIds disabled because we don't need the
// auto-ID anchors and they make the output noisier.
marked.use({
  gfm: false,
  breaks: true,
})

export function renderMarkdownSafe(body: string): string {
  if (!body) return ""
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
    ADD_ATTR: ["target"],
  })
}

/// Server-side plain-text fallback. Used on the FIRST render
/// before client hydration kicks in. Keeps the layout from
/// flashing huge then collapsing.
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
