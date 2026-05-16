import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { resolveCurrentOncall } from "@/lib/oncall"
import OncallScheduleForm from "../OncallScheduleForm"

export const dynamic = "force-dynamic"

interface StoredSlot {
  userId?: string
  dayOfWeek?: number
  start?: string
  end?: string
}
interface StoredOverride {
  userId?: string
  start?: string
  end?: string
  reason?: string | null
}

export default async function EditOncallSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const sched = await prisma.fl_OncallSchedule.findUnique({ where: { id } })
  if (!sched) notFound()

  const staff = await prisma.fl_StaffUser.findMany({
    where: { isActive: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, email: true, name: true, phoneE164: true },
  })

  let parsedRotation: StoredSlot[] = []
  let parsedOverrides: StoredOverride[] = []
  try { parsedRotation = JSON.parse(sched.rotationJson) as StoredSlot[] } catch { /* shrug */ }
  try {
    if (sched.overridesJson) parsedOverrides = JSON.parse(sched.overridesJson) as StoredOverride[]
  } catch { /* shrug */ }

  const rotation = parsedRotation
    .filter((s): s is Required<Pick<StoredSlot, "userId" | "dayOfWeek" | "start" | "end">> =>
      typeof s?.userId === "string" &&
      typeof s.dayOfWeek === "number" &&
      typeof s.start === "string" &&
      typeof s.end === "string",
    )
    .map((s) => ({ userId: s.userId, dayOfWeek: s.dayOfWeek, start: s.start, end: s.end }))

  const overrides = parsedOverrides
    .filter((o): o is Required<Pick<StoredOverride, "userId" | "start" | "end">> & { reason?: string | null } =>
      typeof o?.userId === "string" &&
      typeof o.start === "string" &&
      typeof o.end === "string",
    )
    .map((o) => ({
      userId: o.userId,
      start: o.start,
      end: o.end,
      reason: o.reason ?? "",
    }))

  // Live "who's on call right now" preview — same resolver the
  // dispatcher uses. Lets operators sanity-check the rotation
  // without firing an alert.
  const oncallNow = await resolveCurrentOncall(sched.id)

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: 920 }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            Edit on-call schedule
          </h1>
          <p style={{ fontSize: "12px", margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "var(--color-text-secondary)" }}>
            {sched.id}
          </p>
        </header>

        <div
          style={{
            padding: "10px 12px",
            background: oncallNow
              ? "var(--color-success-soft, rgba(21, 128, 61, 0.08))"
              : "var(--color-warning-soft, rgba(234, 179, 8, 0.1))",
            border: `0.5px solid ${oncallNow ? "var(--color-success, #15803d)" : "var(--color-warning, #b45309)"}`,
            borderRadius: 8,
            fontSize: 12,
            color: "var(--color-text-primary)",
          }}
        >
          <strong>On-call right now:</strong>{" "}
          {oncallNow
            ? `${oncallNow.user.name ?? oncallNow.user.email}${oncallNow.fromOverride ? " (override)" : ""} — ${oncallNow.user.email}${oncallNow.user.phoneE164 ? ` · ${oncallNow.user.phoneE164}` : " · no phone"}`
            : "nobody scheduled — alerts to this schedule will fail at dispatch time"}
        </div>

        <OncallScheduleForm
          initial={{
            id: sched.id,
            name: sched.name,
            rotation,
            overrides,
            isActive: sched.isActive,
          }}
          staff={staff}
        />
      </div>
    </AppShell>
  )
}
