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
            Pre-create a client so it appears in <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "12px" }}>/clients</code>{" "}
            before any agent has enrolled. The name must match the
            <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "12px" }}> clientName</code>{" "}
            the first agent will register under — and the
            <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "12px" }}> TH_Client.name</code>{" "}
            in TicketHub.
          </p>
        </header>
        <NewClientForm />
      </div>
    </AppShell>
  )
}
