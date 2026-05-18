// Phase 12 WS-C.4 — extend Phase 11's Slack-only migration to also
// seal SMTP passwords, PagerDuty integration keys, and Teams
// webhooks. Same idempotent dry-run / apply shape; same channelsJson
// in-place rewrite.
//
// Usage:
//   cd /home/msaville/fleethub/app && npx tsx scripts/migrate-channel-secrets-to-vault.ts --dry-run
//   ... && npx tsx scripts/migrate-channel-secrets-to-vault.ts --apply

import { prisma } from "@/lib/prisma"
import { seal, type CredentialKind } from "@/lib/credential-vault"

type Entry = {
  type: string
  // Slack: phase 11 migrated. webhookUrl plaintext (legacy) OR
  // credentialId (already in vault).
  webhookUrl?: string
  credentialId?: string
  masked?: string
  // SMTP — phase-7-shipped channel for email-via-Graph; the
  // operator-configured password lands here in the alert-route
  // channels payload.
  smtpPassword?: string
  // PagerDuty
  integrationKey?: string
  // Teams (same shape as Slack)
  // Teams already uses webhookUrl key; type discriminator distinguishes.
  [k: string]: unknown
}

interface Plan {
  routeId: string
  index: number
  type: string
  field: keyof Entry
  kind: CredentialKind
  preview: string
}

function tail(s: string, n: number): string {
  const t = s.replace(/\/$/, "")
  return `…${t.slice(-n)}`
}

function maskedFor(type: string, value: string): string {
  switch (type) {
    case "slack":
    case "teams":
      return tail(value, 12)
    case "smtp":
      return "••••" + value.slice(-2)
    case "pagerduty":
      return "••••" + value.slice(-4)
    default:
      return "••••" + value.slice(-4)
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply")
  console.log(`[migrate-channel-secrets] mode = ${dryRun ? "dry-run" : "apply"}`)

  const routes = await prisma.fl_AlertRoute.findMany({})
  const plans: Plan[] = []
  for (const route of routes) {
    let parsed: Entry[]
    try {
      parsed = JSON.parse(route.channelsJson) as Entry[]
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue
    for (let i = 0; i < parsed.length; i++) {
      const e = parsed[i]
      if (e.credentialId) continue // already in vault
      if (e.type === "slack" && typeof e.webhookUrl === "string") {
        plans.push({
          routeId: route.id,
          index: i,
          type: "slack",
          field: "webhookUrl",
          kind: "webhook-secret",
          preview: tail(e.webhookUrl, 12),
        })
      } else if (e.type === "teams" && typeof e.webhookUrl === "string") {
        plans.push({
          routeId: route.id,
          index: i,
          type: "teams",
          field: "webhookUrl",
          kind: "webhook-secret",
          preview: tail(e.webhookUrl, 12),
        })
      } else if (e.type === "smtp" && typeof e.smtpPassword === "string") {
        plans.push({
          routeId: route.id,
          index: i,
          type: "smtp",
          field: "smtpPassword",
          kind: "smtp-password",
          preview: "••••",
        })
      } else if (e.type === "pagerduty" && typeof e.integrationKey === "string") {
        plans.push({
          routeId: route.id,
          index: i,
          type: "pagerduty",
          field: "integrationKey",
          kind: "api-key",
          preview: "••••" + e.integrationKey.slice(-4),
        })
      }
    }
  }

  console.log(`[migrate-channel-secrets] found ${plans.length} channel entries to seal`)
  if (dryRun) {
    for (const p of plans) {
      console.log(`  • ${p.type} entry on route ${p.routeId} (${p.preview})`)
    }
    console.log("\n--dry-run: no writes. Use --apply to commit.")
    return
  }

  let sealed = 0
  for (const p of plans) {
    const route = await prisma.fl_AlertRoute.findUnique({ where: { id: p.routeId } })
    if (!route) continue
    const parsed = JSON.parse(route.channelsJson) as Entry[]
    const entry = parsed[p.index]
    if (!entry || entry.credentialId) continue
    const plaintext = entry[p.field] as string | undefined
    if (typeof plaintext !== "string") continue
    const result = await seal({
      tenantName: route.tenantName ?? "__global__",
      kind: p.kind,
      label: `${p.type} ${p.field}: alert-route ${route.id}`,
      plaintext,
      createdBy: "migrate-channel-secrets-to-vault",
    })
    // Replace the field with credentialId + masked.
    const next: Entry = {
      type: entry.type,
      credentialId: result.id,
      masked: maskedFor(p.type, plaintext),
      // preserve any non-secret fields (e.g. SMTP host/port/from)
      ...Object.fromEntries(
        Object.entries(entry).filter(
          ([k]) => k !== "type" && k !== p.field && k !== "webhookUrl" && k !== "smtpPassword" && k !== "integrationKey",
        ),
      ),
    }
    parsed[p.index] = next
    await prisma.fl_AlertRoute.update({
      where: { id: route.id },
      data: { channelsJson: JSON.stringify(parsed) },
    })
    sealed++
  }
  console.log(`[migrate-channel-secrets] sealed ${sealed} entries.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
