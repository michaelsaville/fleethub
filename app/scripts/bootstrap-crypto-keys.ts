// Phase 11 WS-A — bootstrap initial Fl_CryptoKey rows. Idempotent:
// for each purpose, if a row already exists this is a no-op.
//
// Usage (from host):
//   cd /home/msaville/fleethub/app && npx tsx scripts/bootstrap-crypto-keys.ts
//
// Requires FLEETHUB_CRYPTO_ROOT_KEY in env. Bootstrap-time creation
// uses createKey() which generates fresh material and wraps it with
// the root key.
//
// The 'ack-signing' key starts as a brand-new HMAC secret — Phase 7's
// alert-ack-token.ts currently signs off NEXTAUTH_SECRET. After this
// bootstrap, a follow-up commit will migrate alert-ack-token.ts to
// use crypto-key.ts (Phase 11 §1 cross-reference).

import { prisma } from "@/lib/prisma"
import { createKey, getActiveKey, type KeyPurpose } from "@/lib/crypto-key"

const PURPOSES: KeyPurpose[] = [
  "vault-kek",
  "approval-signing",
  "step-up-signing",
  "ack-signing",
  "webauthn-rp",
]

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const out: { purpose: KeyPurpose; status: string; version?: number }[] = []
  for (const purpose of PURPOSES) {
    const existing = await prisma.fl_CryptoKey.findFirst({
      where: { purpose, retiredAt: null },
      orderBy: { version: "desc" },
    })
    if (existing) {
      out.push({ purpose, status: "exists", version: existing.version })
      continue
    }
    if (dryRun) {
      out.push({ purpose, status: "would-create" })
      continue
    }
    const created = await createKey(
      purpose,
      "bootstrap",
      `Phase 11 bootstrap @ ${new Date().toISOString()}`,
    )
    // Sanity round-trip: load via getActiveKey, confirm it unwraps.
    const active = await getActiveKey(purpose)
    if (active.version !== created.version) {
      throw new Error(
        `Bootstrap roundtrip failed for ${purpose}: created v${created.version}, getActiveKey v${active.version}`,
      )
    }
    out.push({ purpose, status: "created", version: created.version })
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ result: out }, null, 2))
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Bootstrap failed:", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
