import Link from "next/link"
import { notFound } from "next/navigation"
import AppShell from "@/components/AppShell"
import { prisma } from "@/lib/prisma"
import PackageActions from "./PackageActions"

export const dynamic = "force-dynamic"

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const pkg = await prisma.fl_Package.findUnique({
    where: { id },
    include: { versions: { orderBy: { createdAt: "desc" } } },
  })
  if (!pkg) notFound()

  const detection = pkg.detectionRuleJson ? safeParse(pkg.detectionRuleJson) as Record<string, unknown> | null : null
  const vendorMeta = pkg.vendorMetadataJson ? safeParse(pkg.vendorMetadataJson) as Record<string, unknown> | null : null

  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 4 }}>{pkg.name}</h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: 0 }}>
              <span style={{ padding: "2px 8px", borderRadius: 4, background: "var(--color-background-tertiary)", marginRight: 6 }}>{pkg.source}</span>
              <code>{pkg.sourceId}</code>
              {" · "}{pkg.os}
              {" · "}tenant <strong>{pkg.tenantName}</strong>
              {pkg.archivedAt && <span style={{ marginLeft: 8, color: "var(--color-text-muted)" }}>· archived</span>}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!pkg.archivedAt && pkg.versions.length > 0 && pkg.isApproved && (
              <Link href={`/deployments/new?packageId=${pkg.id}`} style={btnPrimaryStyle()}>
                Deploy →
              </Link>
            )}
            <PackageActions packageId={pkg.id} isApproved={pkg.isApproved} isArchived={!!pkg.archivedAt} />
            <Link href="/packages" style={{ fontSize: 12, color: "var(--color-text-secondary)", textDecoration: "none" }}>
              ← Catalog
            </Link>
          </div>
        </header>

        <Card title="Settings">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              <Row label="Reboot policy" value={pkg.rebootPolicy} />
              <Row label="Scope" value={pkg.scope} />
              <Row label="Dry-run capable" value={pkg.dryRunCapable ? "yes" : "no"} />
              <Row label="Signed body required" value={pkg.signedBody ? "yes" : "no"} />
              <Row label="Silent install args" value={pkg.silentInstallArgs ?? "—"} mono />
              <Row label="Silent uninstall args" value={pkg.silentUninstallArgs ?? "—"} mono />
              <Row label="Approval status" value={pkg.isApproved ? "approved" : "pending"} />
            </tbody>
          </table>
        </Card>

        {detection && (
          <Card title="Detection rule">
            <pre style={preStyle()}>{JSON.stringify(detection, null, 2)}</pre>
          </Card>
        )}

        {vendorMeta && Object.keys(vendorMeta).length > 0 && (
          <Card title="Vendor metadata">
            <pre style={preStyle()}>{JSON.stringify(vendorMeta, null, 2)}</pre>
          </Card>
        )}

        <Card title={`Versions (${pkg.versions.length})`}>
          {pkg.versions.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>No versions yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--color-text-muted)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={th()}>Version</th>
                  <th style={th()}>Approved default</th>
                  <th style={th()}>Created</th>
                  <th style={th()}>Artifact</th>
                </tr>
              </thead>
              <tbody>
                {pkg.versions.map((v) => (
                  <tr key={v.id} style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={td()}><code>{v.version}</code></td>
                    <td style={td()}>{v.isApprovedDefault ? <span style={{ color: "var(--color-success)" }}>✓</span> : "—"}</td>
                    <td style={td()}>{new Date(v.createdAt).toLocaleString()}</td>
                    <td style={td()}>{v.artifactUrl ? <span style={{ color: "var(--color-text-muted)" }}>{v.artifactUrl.slice(0, 40)}…</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </AppShell>
  )
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10 }}>
      <div style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  )
}
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
      <td style={{ padding: "6px 10px", color: "var(--color-text-muted)", width: 200 }}>{label}</td>
      <td style={{ padding: "6px 10px", color: "var(--color-text-primary)", fontFamily: mono ? "ui-monospace, SFMono-Regular, monospace" : undefined }}>{value}</td>
    </tr>
  )
}
function th(): React.CSSProperties {
  return { textAlign: "left", padding: "8px 10px", fontWeight: 600 }
}
function td(): React.CSSProperties {
  return { padding: "8px 10px", color: "var(--color-text-primary)", verticalAlign: "top" }
}
function preStyle(): React.CSSProperties {
  return {
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    background: "var(--color-background)",
    padding: 12,
    borderRadius: 6,
    overflow: "auto",
    margin: 0,
  }
}
function btnPrimaryStyle(): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: 6, background: "var(--color-accent)", color: "#fff", textDecoration: "none", border: "0.5px solid var(--color-border-secondary)" }
}
