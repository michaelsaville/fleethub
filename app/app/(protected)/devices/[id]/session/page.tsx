import { notFound, redirect } from "next/navigation"
import { getSessionContext } from "@/lib/authz"
import { loadSessionWorkspace } from "@/lib/session-workspace"
import SessionWorkspace from "./SessionWorkspace"

// Remote-session workspace (2026-09-13): full-bleed page, no AppShell —
// the whole viewport is the viewer + the context rail. Opened by the
// Remote-in launcher in a new tab; `s` is the Fl_RemoteSession id.
export const dynamic = "force-dynamic"

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ s?: string }>
}) {
  const ctx = await getSessionContext()
  if (!ctx) redirect("/login")
  const { id } = await params
  const { s } = await searchParams
  if (!s) notFound()

  const data = await loadSessionWorkspace(s, ctx.email, ctx.role === "ADMIN")
  if ("error" in data) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui", color: "var(--color-text-secondary)" }}>
        {data.error}. <a href={`/devices/${id}`}>Back to device</a>
      </div>
    )
  }
  if (data.device.id !== id) notFound()

  return <SessionWorkspace data={data} operatorEmail={ctx.email} />
}
