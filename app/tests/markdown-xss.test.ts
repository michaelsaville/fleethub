import { describe, it, expect } from "vitest"
import { renderMarkdownSafe } from "../lib/markdown"

// Phase 11 WS-E.6 — XSS vector coverage for the markdown renderer.
// Closes the Phase-10 gap on lib/markdown.ts. Vectors lifted from
// OWASP cheatsheet + the audit's specific call-outs (data:, target+
// rel autoinject).

describe("renderMarkdownSafe XSS", () => {
  it("strips <script> tags entirely", () => {
    const out = renderMarkdownSafe("hi <script>alert(1)</script> bye")
    expect(out).not.toContain("<script")
    expect(out).not.toContain("alert(1)")
  })

  it("strips inline event handlers (onerror, onclick)", () => {
    const out = renderMarkdownSafe('<img src=x onerror="alert(1)">')
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("alert(1)")
  })

  it("blocks javascript: in link href", () => {
    const out = renderMarkdownSafe("[click](javascript:alert(1))")
    expect(out).not.toContain("javascript:")
  })

  it("blocks data: in link href", () => {
    const out = renderMarkdownSafe("[click](data:text/html,<script>alert(1)</script>)")
    expect(out).not.toContain("data:")
    expect(out).not.toContain("alert(1)")
  })

  it("blocks vbscript: in link href", () => {
    const out = renderMarkdownSafe("[click](vbscript:msgbox('x'))")
    expect(out).not.toContain("vbscript:")
  })

  it("blocks file: in link href", () => {
    const out = renderMarkdownSafe("[a](file:///etc/passwd)")
    expect(out).not.toContain("file:")
  })

  it("allows http and https", () => {
    const out = renderMarkdownSafe("[ok](https://example.com)")
    expect(out).toContain("https://example.com")
  })

  it("allows mailto:", () => {
    const out = renderMarkdownSafe("[mail](mailto:a@b.com)")
    expect(out).toContain("mailto:a@b.com")
  })

  it("allows in-page anchor (#)", () => {
    const out = renderMarkdownSafe("[top](#top)")
    expect(out).toContain('href="#top"')
  })

  it("autoinjects rel='noopener noreferrer' on every <a>", () => {
    const out = renderMarkdownSafe("[ok](https://example.com)")
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it("autoinjects target='_blank' on external links", () => {
    const out = renderMarkdownSafe("[ok](https://example.com)")
    expect(out).toContain('target="_blank"')
  })

  it("does not autoinject target on in-page anchors", () => {
    const out = renderMarkdownSafe("[top](#top)")
    // # links should not get target=_blank (operator stays on same page)
    expect(out).not.toMatch(/href="#top"[^>]*target="_blank"/)
  })

  it("strips iframe entirely", () => {
    const out = renderMarkdownSafe('<iframe src="https://evil"></iframe>')
    expect(out).not.toContain("<iframe")
  })

  it("strips style attribute (no inline CSS injection)", () => {
    const out = renderMarkdownSafe('<p style="background:url(javascript:alert(1))">x</p>')
    expect(out).not.toContain("style=")
  })

  it("strips on* attributes regardless of casing", () => {
    const out = renderMarkdownSafe('<a href="https://x" OnClick="alert(1)">click</a>')
    expect(out).not.toMatch(/on\w+=/i)
  })

  it("strips <object> and <embed>", () => {
    const out = renderMarkdownSafe('<object data="x.swf"></object><embed src="x.swf">')
    expect(out).not.toContain("<object")
    expect(out).not.toContain("<embed")
  })

  it("preserves <strong> and <em>", () => {
    const out = renderMarkdownSafe("**bold** and _italic_")
    expect(out).toMatch(/<strong>bold<\/strong>/)
    expect(out).toMatch(/<em>italic<\/em>/)
  })

  it("preserves <code> with inline backticks", () => {
    const out = renderMarkdownSafe("call `foo()` here")
    expect(out).toMatch(/<code>foo\(\)<\/code>/)
  })

  it("preserves <pre><code> fenced blocks", () => {
    const out = renderMarkdownSafe("```\nfoo\n```")
    expect(out).toMatch(/<pre>[\s\S]*<code>[\s\S]*foo[\s\S]*<\/code>[\s\S]*<\/pre>/)
  })

  it("empty body returns empty string", () => {
    expect(renderMarkdownSafe("")).toBe("")
  })
})
