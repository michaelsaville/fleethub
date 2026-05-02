import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import { getSessionContext } from "@/lib/authz"
import PatchApprovalActions from "./PatchApprovalActions"

export const dynamic = "force-dynamic"

const SOURCE_COLOR: Record<string, string> = {
  ms: "#3c82f6",
  thirdparty: "#a855f7",
  custom: "#10b981",
}

export default async function PatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await getSessionContext()
  const isAdmin = ctx?.role === "ADMIN"
  const patch = await prisma.fl_Patch.findUnique({
    where: { id },
    include: {
      installs: {
        orderBy: [{ state: "asc" }, { lastDetectedAt: "desc" }],
        take: 200,
      },
    },
  })
  if (!patch) notFound()

  const cves = parseCveList(patch.cveJson)
  const supersedes = parseCveList(patch.supersedesIdsJson)

  // Fetch advisory metadata for each CVE.
  const advisories = cves.length > 0
    ? await prisma.fl_PatchAdvisory.findMany({ where: { cveId: { in: cves } } })
    : []

  // Fetch hostnames for the install rows.
  const deviceIds = Array.from(new Set(patch.installs.map((i) => i.deviceId)))
  const devices = await prisma.fl_Device.findMany({
    where: { id: { in: deviceIds } },
    select: { id: true, hostname: true, clientName: true, os: true },
  })
  const deviceById = Object.fromEntries(devices.map((d) => [d.id, d]))

  const stateCounts: Record<string, number> = {}
  for (const i of patch.installs) stateCounts[i.state] = (stateCounts[i.state] ?? 0) + 1
  const missingIds = patch.installs.filter((i) => i.state === "missing").map((i) => i.deviceId)

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080 }}>
        <header>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
            <Link href="/patches" style={{ color: "inherit", textDecoration: "none" }}>← Patches</Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: SOURCE_COLOR[patch.source] ?? "#777", color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {patch.source}
            </span>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
              {patch.sourceId}
            </h1>
            {patch.isKev && <span style={pill("var(--color-danger)")}>KEV</span>}
            {patch.isHotpatch && <span style={pill("var(--color-success)")}>HOTPATCH</span>}
            <span style={pill(approvalColor(patch.approvalState))}>{patch.approvalState}</span>
          </div>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0 }}>
            {patch.title}
          </p>
        </header>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {patch.approvalState === "approved" && missingIds.length > 0 && (
            <Link
              href={`/deployments/new?patchId=${patch.id}&targets=${missingIds.slice(0, 200).join(",")}`}
              style={btnPrimary()}
            >
              Deploy to {missingIds.length} missing host{missingIds.length === 1 ? "" : "s"} →
            </Link>
          )}
          <PatchApprovalActions
            patchId={patch.id}
            currentState={patch.approvalState}
            isAdmin={isAdmin}
          />
          {patch.approvedBy && patch.approvedAt && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              {patch.approvalState} by {patch.approvedBy} · {new Date(patch.approvedAt).toLocaleString()}
            </span>
          )}
        </div>
        {patch.notes && (
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "8px 12px", background: "var(--color-background-tertiary)", borderRadius: 6, border: "0.5px solid var(--color-border-tertiary)" }}>
            <strong style={{ fontSize: 10.5, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 8 }}>Note</strong>
            {patch.notes}
          </div>
        )}

        <Card title="Patch metadata">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              <Row label="OS" value={patch.os} />
              <Row label="Classification" value={patch.classification} />
              <Row label="Requires reboot" value={patch.requiresReboot === null ? "unknown" : patch.requiresReboot ? "yes" : "no"} />
              <Row label="Hotpatch" value={patch.isHotpatch ? "yes — installs without reboot" : "no"} />
              <Row label="Published" value={patch.publishedAt ? new Date(patch.publishedAt).toLocaleDateString() : "—"} />
              <Row label="Ingested" value={new Date(patch.ingestedAt).toLocaleString()} />
              {supersedes.length > 0 && (
                <Row label="Supersedes" value={`${supersedes.length} prior patch${supersedes.length === 1 ? "" : "es"}`} />
              )}
            </tbody>
          </table>
        </Card>

        {advisories.length > 0 && (
          <Card title={`CVEs · ${advisories.length}`}>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
              {advisories
                .sort((a, b) => Number(b.isKev) - Number(a.isKev) || (b.cvssBase ?? 0) - (a.cvssBase ?? 0))
                .map((a) => (
                  <li
                    key={a.cveId}
                    style={{
                      padding: "8px 10px",
                      border: "0.5px solid var(--color-border-tertiary)",
                      borderLeft: a.isKev ? "3px solid var(--color-danger)" : "3px solid var(--color-text-muted)",
                      borderRadius: 5,
                      background: "var(--color-background-tertiary)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                      {a.isKev && <span style={pill("var(--color-danger)")}>KEV</span>}
                      {a.ransomwareUseKnown && <span style={pill("#7c2d12")}>RANSOMWARE</span>}
                      {a.cvssBase != null && <span style={pill(cvssColor(a.cvssBase))}>CVSS {a.cvssBase.toFixed(1)}</span>}
                      <a
                        href={`https://nvd.nist.gov/vuln/detail/${a.cveId}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 600, color: "var(--color-text-primary)" }}
                      >
                        {a.cveId}
                      </a>
                      <span style={{ color: "var(--color-text-muted)" }}>{[a.vendor, a.product].filter(Boolean).join(" · ")}</span>
                      {a.kevAddedAt && (
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-muted)" }}>
                          KEV added {new Date(a.kevAddedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {a.description && (
                      <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                        {a.description.length > 280 ? a.description.slice(0, 280) + "…" : a.description}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          </Card>
        )}

        <Card title={`Install state · ${patch.installs.length} hosts`}>
          {patch.installs.length === 0 ? (
            <Empty>No install state yet — agent hasn&rsquo;t scanned for this patch.</Empty>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, fontSize: 11 }}>
                {Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).map(([state, count]) => (
                  <span key={state} style={pill(stateColor(state))}>{state}: {count}</span>
                ))}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    <th style={th()}>Host</th>
                    <th style={th()}>Client</th>
                    <th style={th()}>State</th>
                    <th style={th()}>Detection</th>
                    <th style={th()}>Last detected</th>
                  </tr>
                </thead>
                <tbody>
                  {patch.installs.map((i) => {
                    const d = deviceById[i.deviceId]
                    const methods = [
                      i.wmiQfe == null ? null : `qfe:${i.wmiQfe ? "✓" : "✗"}`,
                      i.dismPackages == null ? null : `dism:${i.dismPackages ? "✓" : "✗"}`,
                      i.wuHistory == null ? null : `wu:${i.wuHistory ? "✓" : "✗"}`,
                    ].filter(Boolean).join(" · ")
                    return (
                      <tr key={i.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                        <td style={td()}>
                          {d ? (
                            <Link href={`/devices/${d.id}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                              {d.hostname}
                            </Link>
                          ) : (
                            <span style={{ color: "var(--color-text-muted)" }}>(deleted)</span>
                          )}
                        </td>
                        <td style={td()}>{d?.clientName ?? "—"}</td>
                        <td style={td()}><span style={pill(stateColor(i.state))}>{i.state}</span></td>
                        <td style={td()}><span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11 }}>{methods || "—"}</span></td>
                        <td style={td()}>{new Date(i.lastDetectedAt).toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </div>
    </AppShell>
  )
}

function parseCveList(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === "string")
  } catch {
    return []
  }
}

function pill(bg: string): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 7px",
    borderRadius: 3,
    background: bg,
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  }
}
function cvssColor(score: number): string {
  if (score >= 9) return "var(--color-danger)"
  if (score >= 7) return "var(--color-warning)"
  if (score >= 4) return "#854d0e"
  return "var(--color-text-muted)"
}
function approvalColor(state: string): string {
  if (state === "approved") return "var(--color-success)"
  if (state === "needs-approval") return "var(--color-warning)"
  if (state === "deferred") return "var(--color-text-muted)"
  return "var(--color-danger)"
}
function stateColor(state: string): string {
  if (state === "installed") return "var(--color-success)"
  if (state === "missing") return "var(--color-warning)"
  if (state === "failed") return "var(--color-danger)"
  if (state === "detection-disagreement") return "#7c2d12"
  return "var(--color-text-muted)"
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  )
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
      <td style={{ padding: "6px 10px", color: "var(--color-text-muted)", width: 200 }}>{label}</td>
      <td style={{ padding: "6px 10px", color: "var(--color-text-primary)" }}>{value}</td>
    </tr>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>{children}</div>
}
function th(): React.CSSProperties {
  return { textAlign: "left", padding: "6px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "6px 10px", color: "var(--color-text-primary)", verticalAlign: "top" }
}
function btnPrimary(): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 500,
    padding: "8px 16px",
    borderRadius: 6,
    background: "var(--color-accent)",
    color: "#fff",
    textDecoration: "none",
    border: "0.5px solid var(--color-border-secondary)",
  }
}
