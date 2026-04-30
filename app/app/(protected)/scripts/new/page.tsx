import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { createScript } from "../actions"
import { ScriptForm } from "../ScriptForm"

export const dynamic = "force-dynamic"

export default async function NewScriptPage() {
  await requireAdmin()
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "800px" }}>
        <header>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            <Link href="/scripts" style={{ color: "inherit", textDecoration: "none" }}>← Scripts</Link>
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            New script
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Saving signs the body — your email is recorded as the signer until another ADMIN re-saves.
          </p>
        </header>
        <ScriptForm action={createScript} submitLabel="Create &amp; sign" />
      </div>
    </AppShell>
  )
}
