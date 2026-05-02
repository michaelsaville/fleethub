import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import { getSessionContext } from "@/lib/authz"
import RunMonitor from "./RunMonitor"

export const dynamic = "force-dynamic"

const STATE_COLOR: Record<string, string> = {
  queued: "var(--color-text-muted)",
  running: "var(--color-accent)",
  ok: "var(--color-success)",
  dryrun: "var(--color-success)",
  error: "var(--color-danger)",
  timeout: "var(--color-warn)",
  cancelled: "var(--color-text-muted)",
  rejected: "var(--color-danger)",
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await getSessionContext()
  const isAdmin = ctx?.role === "ADMIN"

  const run = await prisma.fl_ScriptRun.findUnique({ where: { id } })
  if (!run) notFound()

  const [script, device] = await Promise.all([
    prisma.fl_Script.findUnique({ where: { id: run.scriptId }, select: { id: true, name: true, shell: true } }),
    prisma.fl_Device.findUnique({ where: { id: run.deviceId }, select: { id: true, hostname: true, clientName: true, os: true } }),
  ])

  const isLive = run.state === "queued" || run.state === "running"
  const args = run.argsJson ? safeParse<string[]>(run.argsJson) : null
  const env = run.envJson ? safeParse<Record<string, string>>(run.envJson) : null

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
              {script ? <Link href={`/scripts/${script.id}`} style={{ color: "inherit", textDecoration: "none" }}>← {script.name}</Link> : "← Script"}
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Run · {script?.name ?? "(unknown script)"}
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: "4px 0 0" }}>
              On{" "}
              {device ? (
                <Link href={`/devices/${device.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                  {device.hostname}
                </Link>
              ) : "(unknown host)"}
              {device && <> · {device.clientName} · {device.os}</>}
              {run.dryRun && (
                <span style={{ marginLeft: 12, padding: "2px 8px", borderRadius: 4, background: "var(--color-warn)", color: "#fff", fontSize: 11, fontWeight: 600 }}>
                  DRY-RUN
                </span>
              )}
            </p>
          </div>
        </header>

        <RunMonitor
          runId={run.id}
          state={run.state}
          isLive={isLive}
          isAdmin={isAdmin}
          stdout={run.output}
          stderr={run.stderr}
          exitCode={run.exitCode}
          durationMs={run.durationMs}
          rejectReason={run.rejectReason}
          startedAt={run.startedAt?.toISOString() ?? null}
          finishedAt={run.finishedAt?.toISOString() ?? null}
          createdAt={run.createdAt.toISOString()}
          stateColor={STATE_COLOR[run.state] ?? "var(--color-text-muted)"}
          args={args}
          env={env}
          interpreter={script?.shell ?? "(unknown)"}
        />
      </div>
    </AppShell>
  )
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T } catch { return null }
}
