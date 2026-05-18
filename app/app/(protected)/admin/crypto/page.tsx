import Link from "next/link"
import { createHash } from "node:crypto"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { DataTable, TH, TD } from "@/components/ui/Table"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { MaskedField } from "@/components/ui/MaskedField"
import { TYPOGRAPHY } from "@/lib/ui-tokens"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"

// Phase 12 WS-C.3 — Fl_CryptoKey list + rotation entry point.
// ADMIN-only.

export const dynamic = "force-dynamic"

function fingerprint(keyMaterial: Uint8Array | Buffer): string {
  return createHash("sha256")
    .update(Buffer.from(keyMaterial))
    .digest("hex")
    .slice(0, 16)
}

export default async function CryptoPage() {
  await requireAdmin()
  const [keys, activeRotation] = await Promise.all([
    prisma.fl_CryptoKey.findMany({
      orderBy: [{ purpose: "asc" }, { version: "desc" }],
    }),
    prisma.fl_CryptoRotation.findFirst({
      where: { state: "in-progress" },
      orderBy: { startedAt: "desc" },
    }),
  ])
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={TYPOGRAPHY.H1}>Crypto keys</h1>
        <div style={TYPOGRAPHY.HINT}>
          Server-side keys for the credential vault (vault-kek), 4-eyes
          approval tokens (approval-signing), step-up tokens (step-up-
          signing), Phase-7 alert-ack URLs (ack-signing), and WebAuthn
          relying-party identity (webauthn-rp). Rotation is operator-
          initiated + step-up gated. Vault-KEK rotation rewraps every
          Fl_Credential row.
        </div>
        {activeRotation && (
          <InlineAlert tone="warn">
            Rotation in progress: {activeRotation.purpose} v
            {activeRotation.fromVersion} → v{activeRotation.toVersion} —{" "}
            {activeRotation.processed} / {activeRotation.total} credentials
            rewrapped.{" "}
            <Link
              href={`/admin/crypto/rotate?purpose=${activeRotation.purpose}&id=${activeRotation.id}`}
              style={{ color: "var(--color-text-accent)" }}
            >
              Watch progress →
            </Link>
          </InlineAlert>
        )}
        <Card>
          <CardHeader title={`${keys.length} key rows`} />
          <DataTable>
            <thead>
              <tr>
                <TH>Purpose</TH>
                <TH>Algorithm</TH>
                <TH>Version</TH>
                <TH>Created</TH>
                <TH>Retired</TH>
                <TH>Fingerprint</TH>
                <TH>Actions</TH>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const fp = fingerprint(k.keyMaterial)
                return (
                  <tr key={k.id}>
                    <TD style={{ fontWeight: 500 }}>{k.purpose}</TD>
                    <TD>{k.algorithm}</TD>
                    <TD>v{k.version}</TD>
                    <TD style={{ fontSize: 11 }}>{new Date(k.createdAt).toLocaleString()}</TD>
                    <TD style={{ fontSize: 11 }}>
                      {k.retiredAt ? new Date(k.retiredAt).toLocaleString() : "—"}
                    </TD>
                    <TD>
                      <MaskedField
                        value={fp}
                        displayMasked={`••••${fp.slice(-4)}`}
                        compact
                      />
                    </TD>
                    <TD>
                      {k.purpose === "vault-kek" && !k.retiredAt && !activeRotation && (
                        <Link href={`/admin/crypto/rotate?purpose=${k.purpose}`}>
                          <Button variant="danger" size="sm">
                            Rotate
                          </Button>
                        </Link>
                      )}
                    </TD>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        </Card>
      </div>
    </AppShell>
  )
}
