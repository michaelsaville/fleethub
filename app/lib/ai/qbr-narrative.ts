import "server-only"
import type { QbrData } from "@/lib/reports/qbr"

// PHASE-5-DESIGN §10: optional Claude API hook for QBR cover-page narrative.
// Calls DocHub's /api/ai/proxy with a structured payload of QBR metrics.
// Pure additive — never throws to the caller; failure returns null and the
// PDF renders without the narrative paragraph.
//
// Activation:
//   Fl_Tenant.qbrAutoNarrative = true (per-tenant opt-in)
//   env DOCHUB_AI_PROXY_URL  (defaults to http://dochub-app-1:3000/api/ai/proxy)
//   env AI_PROXY_TOKEN       (matches DocHub-side .env)
// When either env var is missing, this is a no-op and we return null.

const DEFAULT_URL = "http://dochub-app-1:3000/api/ai/proxy"
const APP_ID = "fleethub"
const MODEL = "claude-sonnet-4-6"
const MAX_TOKENS = 700
const TIMEOUT_MS = 30_000

const SYSTEM_PROMPT = [
  "You are writing a 3-paragraph executive narrative for a Quarterly Business Review report from an MSP to its client.",
  "Audience: a non-technical business owner. Avoid jargon (no \"KEV\", \"CVSS\", \"EOL\" without paraphrase).",
  "Tone: confident, plain-spoken, factual. No marketing fluff. No promises about future timelines.",
  "Length: exactly 3 paragraphs. Roughly 60-90 words each. ASCII characters only — no em dashes, no curly quotes, no arrows.",
  "Structure:",
  "  1. What we did this quarter (the headline metrics, framed as outcomes).",
  "  2. Where we improved or had wins.",
  "  3. What we are watching going into next quarter (risks, recommended actions).",
  "Use the structured numbers in the user message. Do not invent numbers or events not present.",
].join("\n")

export async function generateQbrNarrative(data: Omit<QbrData, "narrative">): Promise<string | null> {
  const url = process.env.DOCHUB_AI_PROXY_URL || DEFAULT_URL
  const token = process.env.AI_PROXY_TOKEN
  if (!token) {
    console.log("[qbr-narrative] AI_PROXY_TOKEN not set; skipping narrative")
    return null
  }

  const userPayload = {
    tenant: data.tenantName,
    period: data.periodLabel,
    headline: data.headline,
    wins: data.wins.map((w) => ({
      title: w.title,
      severity: w.severity,
      durationDays: w.durationDays,
    })),
    notableDeploys: data.notableDeploys.map((d) => ({
      package: d.packageName,
      success: d.succeeded,
      total: d.totalTargets,
    })),
    risks: {
      openKevCves: data.risks.kevExposure.length,
      kevAffectedHosts: data.risks.kevExposure.reduce((a, k) => a + k.affectedHosts, 0),
      eolHostCount: data.risks.eolHosts.length,
      identityGaps: data.risks.identityGaps.length,
    },
    lookingAhead: data.lookingAhead.map((l) => ({ label: l.label, detail: l.detail })),
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-app": APP_ID,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              "Write the 3-paragraph QBR narrative using these structured numbers:",
              "",
              JSON.stringify(userPayload, null, 2),
            ].join("\n"),
          },
        ],
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => "")
      console.error(`[qbr-narrative] proxy ${res.status}: ${detail.slice(0, 200)}`)
      return null
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>
    }
    const text = json.content
      ?.filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("\n\n")
      .trim()
    if (!text) return null
    return stripNonAscii(text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[qbr-narrative] failed:", msg)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Helvetica's bundled glyph set silently corrupts non-ASCII (per @react-pdf
// memory note). Strip anything outside ASCII to keep the PDF clean even if
// the model slips a curly quote or em dash through.
function stripNonAscii(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[…]/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
}
