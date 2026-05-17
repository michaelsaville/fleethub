import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { Card, CardHeader } from "@/components/ui/Card"
import { EmptyState } from "@/components/ui/EmptyState"
import { Field, FieldInput } from "@/components/ui/Field"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/authz"
import { updateStaffProfile } from "../actions"

export const dynamic = "force-dynamic"

/**
 * Phase 8 Workstream D step 6.1 — per-staff editor page. Closes the
 * SQL-as-UI gap (`phoneE164` was previously only settable by direct
 * SQL, which is a real embarrassment for an SMS-dispatching alert
 * system). v1 scope:
 *   - email (read-only, edit means deactivate-then-add)
 *   - name (editable)
 *   - phoneE164 (E.164 input + strict validation)
 *   - read-only "on these schedules" list with deep-links
 *
 * Out of scope v1 (need schema work):
 *   - multi-select schedule membership editing
 *   - notification prefs (mute critical/warn/info per channel)
 */
export default async function StaffEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params

  const [user, schedules] = await Promise.all([
    prisma.fl_StaffUser.findUnique({ where: { id } }),
    prisma.fl_OncallSchedule.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, rotationJson: true, overridesJson: true },
    }),
  ])
  if (!user) notFound()

  // Walk each schedule's JSON blobs looking for this user's id in any
  // rotation slot or override. Failure to parse a malformed JSON blob
  // is silent — the schedule editor itself surfaces those errors.
  type ScheduleHit = {
    id: string
    name: string
    rotationSlots: number
    overrides: number
  }
  const memberships: ScheduleHit[] = []
  for (const s of schedules) {
    let rotationSlots = 0
    let overrides = 0
    try {
      const rotation = JSON.parse(s.rotationJson) as Array<{ userId?: string }>
      if (Array.isArray(rotation)) {
        rotationSlots = rotation.filter((slot) => slot.userId === id).length
      }
    } catch {
      // Malformed schedule JSON — ignore here. Schedule edit page warns.
    }
    if (s.overridesJson) {
      try {
        const ov = JSON.parse(s.overridesJson) as Array<{ userId?: string }>
        if (Array.isArray(ov)) {
          overrides = ov.filter((slot) => slot.userId === id).length
        }
      } catch {
        // Same — ignored at this level.
      }
    }
    if (rotationSlots > 0 || overrides > 0) {
      memberships.push({ id: s.id, name: s.name, rotationSlots, overrides })
    }
  }

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <header>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            <Link href="/setup/staff" style={{ color: "inherit", textDecoration: "none" }}>
              ← Staff &amp; roles
            </Link>
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            {user.name?.trim() || user.email}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Profile fields used by SMS dispatch + on-call resolution.
          </p>
        </header>

        <Card>
          <CardHeader title="Profile" />
          <form
            action={updateStaffProfile}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr) minmax(180px, 1fr)",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <input type="hidden" name="id" value={user.id} />
            <Field label="Email" hint="Edit means deactivate-then-add.">
              <FieldInput
                value={user.email}
                readOnly
                disabled
                style={{ opacity: 0.65 }}
              />
            </Field>
            <Field label="Name">
              <FieldInput
                name="name"
                defaultValue={user.name ?? ""}
                placeholder="Optional"
                maxLength={120}
              />
            </Field>
            <Field
              label="Phone (E.164)"
              hint="Required for SMS dispatch. Format: +14155551234"
            >
              <FieldInput
                name="phoneE164"
                type="tel"
                defaultValue={user.phoneE164 ?? ""}
                placeholder="+14155551234"
                pattern="^\+[1-9]\d{7,14}$"
                inputMode="tel"
              />
            </Field>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                style={{
                  padding: "7px 16px",
                  background: "var(--color-accent)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Save profile
              </button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader
            title={`On-call schedules${memberships.length ? ` · ${memberships.length}` : ""}`}
          />
          {memberships.length === 0 ? (
            <EmptyState
              title="Not on any active on-call schedule"
              body={
                <>
                  Add this user as a slot in a schedule via{" "}
                  <Link href="/setup/oncall-schedules" style={{ color: "var(--color-accent)" }}>
                    /setup/oncall-schedules
                  </Link>
                  .
                </>
              }
            />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
              {memberships.map((m) => (
                <li
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "12px",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "0.5px solid var(--color-border-tertiary)",
                  }}
                >
                  <Link
                    href={`/setup/oncall-schedules/${m.id}`}
                    style={{
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      textDecoration: "none",
                    }}
                  >
                    {m.name}
                  </Link>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {m.rotationSlots > 0 && (
                      <>
                        {m.rotationSlots} rotation slot{m.rotationSlots === 1 ? "" : "s"}
                      </>
                    )}
                    {m.rotationSlots > 0 && m.overrides > 0 && " · "}
                    {m.overrides > 0 && (
                      <>
                        {m.overrides} override{m.overrides === 1 ? "" : "s"}
                      </>
                    )}
                  </span>
                  <Link
                    href={`/setup/oncall-schedules/${m.id}`}
                    style={{
                      marginLeft: "auto",
                      fontSize: "11px",
                      color: "var(--color-accent)",
                      textDecoration: "none",
                    }}
                  >
                    Edit schedule →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
