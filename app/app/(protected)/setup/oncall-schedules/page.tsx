import Link from "next/link"
import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function OncallSchedulesPage() {
  await requireAdmin()
  const schedules = await prisma.fl_OncallSchedule.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              On-call schedules
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0, maxWidth: 720 }}>
              Weekly rotations + ISO-dated overrides. Referenced from
              an email or SMS alert channel via{" "}
              <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "12px" }}>
                oncallScheduleId
              </code>{" "}— the current on-call is computed at dispatch
              time, so rotation edits take effect instantly. UTC times
              throughout (DST-aware semantics deferred to v1.5).
            </p>
          </div>
          <Link
            href="/setup/oncall-schedules/new"
            style={{
              flexShrink: 0,
              padding: "8px 14px",
              background: "var(--color-accent, #F97316)",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "8px",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            + New schedule
          </Link>
        </header>

        {schedules.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
            {schedules.map((s) => {
              let slotCount = 0
              let overrideCount = 0
              try { slotCount = (JSON.parse(s.rotationJson) as unknown[]).length } catch { /* shrug */ }
              try { overrideCount = s.overridesJson ? (JSON.parse(s.overridesJson) as unknown[]).length : 0 } catch { /* shrug */ }
              return (
                <Link
                  key={s.id}
                  href={`/setup/oncall-schedules/${s.id}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    padding: "14px",
                    background: "var(--color-background-secondary)",
                    border: "0.5px solid var(--color-border-tertiary)",
                    borderRadius: "10px",
                    textDecoration: "none",
                    color: "inherit",
                    opacity: s.isActive ? 1 : 0.55,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 14 }}>{s.name}</strong>
                    <span
                      style={{
                        padding: "1px 8px",
                        fontSize: "10px",
                        fontWeight: 600,
                        borderRadius: 999,
                        background: s.isActive
                          ? "var(--color-success-soft, rgba(21, 128, 61, 0.15))"
                          : "var(--color-background-tertiary, rgba(148, 163, 184, 0.18))",
                        color: s.isActive
                          ? "var(--color-success, #15803d)"
                          : "var(--color-text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {s.isActive ? "active" : "off"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
                    {slotCount} rotation slot{slotCount === 1 ? "" : "s"}
                    {overrideCount > 0 && ` · ${overrideCount} override${overrideCount === 1 ? "" : "s"}`}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        padding: "40px",
        textAlign: "center",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: "10px",
        color: "var(--color-text-muted)",
        fontSize: "13px",
      }}
    >
      No on-call schedules yet. Click <strong>+ New schedule</strong>{" "}
      to add one — the email + SMS channels on alert routes can then
      reference it for dynamic recipient resolution.
    </div>
  )
}
