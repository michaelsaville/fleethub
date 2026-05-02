import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import { getDeploymentSnapshot, summarizeStage } from "@/lib/deployments"
import DeploymentControls from "./DeploymentControls"
import DeploymentMonitor from "./DeploymentMonitor"

export const dynamic = "force-dynamic"

export default async function DeploymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const snap = await getDeploymentSnapshot(id)
  if (!snap) notFound()

  const pkg = await prisma.fl_Package.findUnique({
    where: { id: snap.deployment.packageId },
    select: { name: true, source: true },
  })
  const ring = await prisma.fl_DeployRing.findUnique({
    where: { id: snap.deployment.ringId },
    select: { name: true },
  })

  // Pull device hostnames for inline display.
  const allTargets = Object.values(snap.targetsByStage).flat()
  const targetIds = Array.from(new Set(allTargets.map((t) => t.deviceId)))
  const devices = await prisma.fl_Device.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, hostname: true, clientName: true, os: true },
  })
  const deviceById: Record<string, { hostname: string; clientName: string; os: string | null }> =
    Object.fromEntries(devices.map((d) => [d.id, { hostname: d.hostname, clientName: d.clientName, os: d.os }]))

  const stageSummaries = snap.stages.map((s) => ({
    name: s.name,
    abortFailureRate: s.abortFailureRate,
    requiresApproval: s.requiresApproval,
    targets: snap.targetsByStage[s.name] ?? [],
    summary: summarizeStage(snap.targetsByStage[s.name] ?? []),
  }))

  const currentStageIdx = snap.stages.findIndex((s) => s.name === snap.deployment.currentStage)
  const isPaused = snap.deployment.status === "paused" || snap.deployment.status === "auto-paused"
  const isRunning = snap.deployment.status === "running"
  const isTerminal = ["completed", "aborted"].includes(snap.deployment.status)

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, marginBottom: "4px", letterSpacing: "-0.01em" }}>
              {snap.deployment.action === "install" ? "Deploying" : snap.deployment.action === "uninstall" ? "Uninstalling" : "Updating"} {pkg?.name ?? "package"}
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>
              {ring?.name} ring · Started{" "}
              {snap.deployment.startedAt ? new Date(snap.deployment.startedAt).toLocaleString() : "—"} by{" "}
              {snap.deployment.requestedBy.split("@")[0]}
              {snap.deployment.dryRun && (
                <span style={{ marginLeft: 12, padding: "2px 8px", borderRadius: 4, background: "var(--color-warn)", color: "#fff", fontSize: 11, fontWeight: 600 }}>
                  DRY-RUN
                </span>
              )}
            </p>
          </div>
          <Link href="/deployments" style={{ fontSize: 12, color: "var(--color-text-secondary)", textDecoration: "none" }}>
            ← All deployments
          </Link>
        </header>

        {isPaused && (
          <div style={{
            padding: "12px 16px",
            background: snap.deployment.status === "auto-paused" ? "var(--color-danger)" : "var(--color-warn)",
            color: "#fff",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
          }}>
            {snap.deployment.status === "auto-paused" ? "🚨 Auto-paused" : "⏸ Paused"}: {snap.deployment.pauseReason || "no reason given"}
          </div>
        )}

        <DeploymentControls
          deploymentId={snap.deployment.id}
          status={snap.deployment.status}
          currentStage={snap.deployment.currentStage}
          canPromote={isPaused && currentStageIdx >= 0 && currentStageIdx < snap.stages.length - 1}
        />

        <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: 14 }}>
          <h2 style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0, marginBottom: 12 }}>
            Stages
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stageSummaries.map((s, i) => {
              const isCurrent = s.name === snap.deployment.currentStage
              const pctDone = s.summary.total === 0 ? 0 : ((s.summary.succeeded + s.summary.failed + s.summary.noOp + s.summary.rebootDeferred + s.summary.skipped) / s.summary.total) * 100
              return (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: isCurrent ? "var(--color-background-tertiary)" : "transparent",
                    border: isCurrent ? "0.5px solid var(--color-accent)" : "0.5px solid transparent",
                  }}
                >
                  <span style={{ width: 80, fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {s.name}
                  </span>
                  <div style={{ flex: 1, height: 8, background: "var(--color-background-tertiary)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
                    <div style={{
                      height: "100%",
                      width: `${pctDone}%`,
                      background: s.summary.failed > 0 ? "var(--color-danger)" : "var(--color-success)",
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", width: 90, textAlign: "right" }}>
                    {s.summary.succeeded + s.summary.noOp + s.summary.rebootDeferred + s.summary.skipped}
                    {s.summary.failed > 0 && <span style={{ color: "var(--color-danger)" }}> · {s.summary.failed} failed</span>}
                    {" / " + s.summary.total}
                  </span>
                  {s.requiresApproval && i > 0 && (
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)" }} title="Requires approval before auto-promote">
                      🔒
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <DeploymentMonitor
          deploymentId={snap.deployment.id}
          stages={stageSummaries}
          deviceById={deviceById}
          isLive={isRunning || isPaused}
          isTerminal={isTerminal}
        />
      </div>
    </AppShell>
  )
}
