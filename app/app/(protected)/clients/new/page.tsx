import AppShell from "@/components/AppShell"
import NewClientForm from "./NewClientForm"

export const dynamic = "force-dynamic"

export default function NewClientPage() {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "520px" }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            New client
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Pick the client from TicketHub. FleetHub shares its database, so the name is
            taken from there verbatim — no retyping, no near-miss spellings.
          </p>
        </header>
        <NewClientForm />
      </div>
    </AppShell>
  )
}
