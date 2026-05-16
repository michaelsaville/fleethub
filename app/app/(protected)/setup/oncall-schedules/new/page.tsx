import AppShell from "@/components/AppShell"
import { requireAdmin } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import OncallScheduleForm from "../OncallScheduleForm"

export const dynamic = "force-dynamic"

export default async function NewOncallSchedulePage() {
  await requireAdmin()
  const staff = await prisma.fl_StaffUser.findMany({
    where: { isActive: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, email: true, name: true, phoneE164: true },
  })

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: 920 }}>
        <header>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
            New on-call schedule
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
            Weekly rotation in UTC, plus ISO-dated override windows
            that beat the rotation. Email + SMS alert channels can
            then reference this schedule to dispatch to the current
            on-call user.
          </p>
        </header>
        <OncallScheduleForm
          initial={{
            id: null,
            name: "",
            rotation: [],
            overrides: [],
            isActive: true,
          }}
          staff={staff}
        />
      </div>
    </AppShell>
  )
}
