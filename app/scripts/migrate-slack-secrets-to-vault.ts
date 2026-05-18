// Phase 11 WS-A.5 — migrate inline Slack webhook URLs into the
// vault. Idempotent: skips entries that already have credentialId set.
// Run from host:
//   cd /home/msaville/fleethub/app && npx tsx scripts/migrate-slack-secrets-to-vault.ts --dry-run
//   cd /home/msaville/fleethub/app && npx tsx scripts/migrate-slack-secrets-to-vault.ts --apply
//
// Reads every Fl_AlertRoute, parses channelsJson, finds entries with
// `type:"slack"` + plaintext `webhookUrl`, calls seal(), writes back
// the row with `credentialId` + `masked` replacing `webhookUrl`.
//
// Sample input row:
//   { "type":"slack", "webhookUrl":"https://hooks.slack.com/services/T0/.../9j" }
// Sample output row:
//   { "type":"slack", "credentialId":"clxxxxxxxxxxxxxxxxxxxxxx", "masked":"…/9j" }

import { prisma } from "@/lib/prisma"
import { seal } from "@/lib/credential-vault"

type SlackEntry = {
  type: "slack"
  webhookUrl?: string
  credentialId?: string
  masked?: string
}

type OtherEntry = { type: string; [k: string]: unknown }

type ChannelEntry = SlackEntry | OtherEntry

function isSlackPlaintext(e: ChannelEntry): e is SlackEntry & { webhookUrl: string } {
  return (
    e.type === "slack" &&
    typeof (e as SlackEntry).webhookUrl === "string" &&
    !(e as SlackEntry).credentialId
  )
}

function maskedSuffix(url: string): string {
  const trimmed = url.replace(/\/$/, "")
  const tail = trimmed.slice(-12)
  return `…${tail}`
}

async function main() {
  const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply")
  // Be explicit — operator MUST opt in to apply.
  if (dryRun) {
    console.log("[migrate-slack] dry-run mode (no writes). Use --apply to commit.")
  }

  const routes = await prisma.fl_AlertRoute.findMany({})
  let total = 0
  let toMigrate = 0
  let migrated = 0
  const skipped: string[] = []
  const sealedIds: string[] = []

  for (const route of routes) {
    let parsed: ChannelEntry[]
    try {
      parsed = JSON.parse(route.channelsJson ?? "[]") as ChannelEntry[]
    } catch {
      skipped.push(`${route.id}: invalid channelsJson`)
      continue
    }
    if (!Array.isArray(parsed)) {
      skipped.push(`${route.id}: channelsJson not an array`)
      continue
    }
    let changed = false
    const next: ChannelEntry[] = []
    for (const entry of parsed) {
      total++
      if (isSlackPlaintext(entry)) {
        toMigrate++
        if (dryRun) {
          next.push(entry)
          continue
        }
        const sealed = await seal({
          tenantName: route.tenantName ?? "__global__",
          kind: "webhook-secret",
          label: `Slack webhook: alert-route ${route.id}`,
          plaintext: entry.webhookUrl,
          createdBy: "migrate-slack-secrets-to-vault",
        })
        const replaced: SlackEntry = {
          type: "slack",
          credentialId: sealed.id,
          masked: maskedSuffix(entry.webhookUrl),
        }
        next.push(replaced)
        sealedIds.push(sealed.id)
        migrated++
        changed = true
      } else {
        next.push(entry)
      }
    }
    if (changed) {
      await prisma.fl_AlertRoute.update({
        where: { id: route.id },
        data: { channelsJson: JSON.stringify(next) },
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        routes_scanned: routes.length,
        channel_entries_scanned: total,
        slack_plaintext_found: toMigrate,
        migrated,
        sealed_credential_ids: sealedIds,
        skipped,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((err) => {
    console.error("[migrate-slack] failed:", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
