import { Cover, Document, Page, PdfFooter, Text, View, styles, COLOR } from "./_shared"
import type { PatchComplianceData } from "@/lib/reports/patch-compliance"

// Audience-gated section visibility per PHASE-5-DESIGN §3.1.
// The render itself is ASCII-only — Helvetica's bundled glyphs silently
// corrupt arrows + curly quotes.

const SECTIONS = {
  cover: ["tech", "client", "auditor"],
  headline: ["tech", "client", "auditor"],
  slaAging: ["tech", "client", "auditor"],
  hostMatrix: ["tech", "auditor"],
  exceptions: ["tech", "auditor"],
  recentKev: ["tech", "client", "auditor"],
} as const

function shows(section: keyof typeof SECTIONS, audience: string): boolean {
  return (SECTIONS[section] as readonly string[]).includes(audience)
}

export function PatchComplianceReport({
  data,
  footerText,
  generatedAt,
}: {
  data: PatchComplianceData
  footerText: string | null
  generatedAt: Date
}) {
  const rangeLabel = `as of ${data.asOf.toISOString().slice(0, 10)}`

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {shows("cover", data.audience) && (
          <Cover
            kind="Patch Compliance"
            tenantName={data.tenantName}
            rangeLabel={rangeLabel}
            audience={data.audience}
            generatedAt={generatedAt}
          />
        )}

        {shows("headline", data.audience) && (
          <View>
            <Text style={styles.sectionHeader}>Headline</Text>
            <View style={styles.headlineRow}>
              <View style={styles.headlineCard}>
                <Text style={styles.headlineNumber}>{data.headline.compliantHosts}</Text>
                <Text style={styles.headlineLabel}>Compliant hosts</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text style={styles.headlineNumber}>{data.headline.totalHosts}</Text>
                <Text style={styles.headlineLabel}>Total hosts</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text style={[styles.headlineNumber, { color: COLOR.bad }]}>
                  {data.headline.overdueCritical}
                </Text>
                <Text style={styles.headlineLabel}>Overdue critical</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text style={[styles.headlineNumber, { color: COLOR.warn }]}>
                  {data.headline.overdueHigh}
                </Text>
                <Text style={styles.headlineLabel}>Overdue high</Text>
              </View>
            </View>
            {data.headline.detectionDisagreements > 0 && (
              <Text style={{ fontSize: 8.5, color: COLOR.kev, marginBottom: 8 }}>
                {data.headline.detectionDisagreements} host(s) with detection disagreement
                — multi-signal scan returned conflicting results. Investigate before relying
                on the compliance numbers above.
              </Text>
            )}
          </View>
        )}

        {shows("slaAging", data.audience) && (
          <View>
            <Text style={styles.sectionHeader}>SLA Aging</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, { width: "20%" }]}>Band</Text>
                <Text style={[styles.th, { width: "20%" }]}>Target</Text>
                <Text style={[styles.th, { width: "20%" }]}>Within SLA</Text>
                <Text style={[styles.th, { width: "20%" }]}>Overdue</Text>
                <Text style={[styles.th, { width: "20%" }]}>Mean days open</Text>
              </View>
              {data.slaAging.map((row) => (
                <View key={row.band} style={styles.tr}>
                  <Text style={[styles.td, { width: "20%", textTransform: "capitalize" }]}>{row.band}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{row.targetDays} days</Text>
                  <Text style={[styles.td, { width: "20%", color: COLOR.ok }]}>{row.withinSla}</Text>
                  <Text style={[styles.td, { width: "20%", color: row.overdue > 0 ? COLOR.bad : COLOR.muted }]}>
                    {row.overdue}
                  </Text>
                  <Text style={[styles.td, { width: "20%" }]}>{row.meanDaysOpen || "-"}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {shows("recentKev", data.audience) && data.recentKev.length > 0 && (
          <View wrap={false}>
            <Text style={styles.sectionHeader}>Recent KEV exposure (last 90 days)</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, { width: "25%" }]}>CVE</Text>
                <Text style={[styles.th, { width: "20%" }]}>Vendor</Text>
                <Text style={[styles.th, { width: "20%" }]}>Product</Text>
                <Text style={[styles.th, { width: "10%" }]}>CVSS</Text>
                <Text style={[styles.th, { width: "12%" }]}>KEV added</Text>
                <Text style={[styles.th, { width: "13%" }]}>Days exposed</Text>
              </View>
              {data.recentKev.slice(0, 15).map((k) => (
                <View key={k.cveId} style={styles.tr}>
                  <Text style={[styles.td, { width: "25%", color: COLOR.kev }]}>{k.cveId}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{k.vendor ?? "-"}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{k.product ?? "-"}</Text>
                  <Text style={[styles.td, { width: "10%" }]}>{k.cvssBase?.toFixed(1) ?? "-"}</Text>
                  <Text style={[styles.td, { width: "12%" }]}>
                    {k.addedAt.toISOString().slice(0, 10)}
                  </Text>
                  <Text style={[styles.td, { width: "13%" }]}>{k.daysExposed}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <PdfFooter tenantName={data.tenantName} footerText={footerText} />
      </Page>

      {shows("hostMatrix", data.audience) && data.hostMatrix.length > 0 && data.patchColumns.length > 0 && (
        <Page size="LETTER" orientation="landscape" style={styles.page}>
          <Text style={styles.sectionHeader}>Per-host KB matrix</Text>
          <Text style={{ fontSize: 8, color: COLOR.muted, marginBottom: 8 }}>
            Showing {data.hostMatrix.length} hosts x {data.patchColumns.length} patches.
            Cells: {"["} OK = installed | MISS = missing | FAIL = failed | PFAIL = preflight-failed | DISAGR = detection-disagreement {"]"}.
            Full set in CSV when format=csv.
          </Text>
          <View style={styles.table}>
            <View style={[styles.tr, styles.thead]}>
              <Text style={[styles.th, { width: 110 }]}>Host</Text>
              {data.patchColumns.map((p) => (
                <Text
                  key={p.sourceId}
                  style={[styles.th, { width: 50, color: p.isKev ? COLOR.kev : COLOR.muted }]}
                >
                  {trim(p.sourceId, 8)}
                </Text>
              ))}
            </View>
            {data.hostMatrix.map((h) => (
              <View key={h.hostname} style={styles.tr}>
                <Text style={[styles.td, { width: 110, fontFamily: "Courier" }]}>
                  {trim(h.hostname, 18)}
                </Text>
                {data.patchColumns.map((p) => {
                  const cell = h.patches[p.sourceId]
                  const label = cell ? cellLabel(cell.state) : "-"
                  const color = cell ? cellColor(cell.state) : COLOR.muted
                  return (
                    <Text
                      key={p.sourceId}
                      style={[styles.td, { width: 50, color, fontSize: 7.5, fontFamily: "Courier" }]}
                    >
                      {label}
                    </Text>
                  )
                })}
              </View>
            ))}
          </View>
          <PdfFooter tenantName={data.tenantName} footerText={footerText} />
        </Page>
      )}

      {shows("exceptions", data.audience) && data.exceptions.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionHeader}>Exception list</Text>
          <Text style={{ fontSize: 8.5, color: COLOR.muted, marginBottom: 8 }}>
            Patches operators have explicitly declined for these hosts. Each row
            carries the justification and approver email.
          </Text>
          <View style={styles.table}>
            <View style={[styles.tr, styles.thead]}>
              <Text style={[styles.th, { width: "20%" }]}>Host</Text>
              <Text style={[styles.th, { width: "20%" }]}>Patch</Text>
              <Text style={[styles.th, { width: "30%" }]}>Reason</Text>
              <Text style={[styles.th, { width: "15%" }]}>Declined by</Text>
              <Text style={[styles.th, { width: "15%" }]}>Declined</Text>
            </View>
            {data.exceptions.slice(0, 60).map((e, idx) => (
              <View key={idx} style={styles.tr}>
                <Text style={[styles.td, { width: "20%", fontFamily: "Courier" }]}>{e.hostname}</Text>
                <Text style={[styles.td, { width: "20%", fontFamily: "Courier" }]}>{e.patchSourceId}</Text>
                <Text style={[styles.td, { width: "30%" }]}>{trim(e.reason, 110)}</Text>
                <Text style={[styles.td, { width: "15%" }]}>{e.declinedBy ?? "-"}</Text>
                <Text style={[styles.td, { width: "15%" }]}>{e.declinedAt ?? "-"}</Text>
              </View>
            ))}
          </View>
          <PdfFooter tenantName={data.tenantName} footerText={footerText} />
        </Page>
      )}
    </Document>
  )
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "."
}

function cellLabel(state: string): string {
  switch (state) {
    case "installed": return "OK"
    case "missing": return "MISS"
    case "failed": return "FAIL"
    case "preflight-failed": return "PFAIL"
    case "detection-disagreement": return "DISAGR"
    case "rollback-failed": return "RBFAIL"
    case "queued": return "QUE"
    case "installing": return "INST"
    default: return state.slice(0, 6).toUpperCase()
  }
}

function cellColor(state: string): string {
  if (state === "installed") return COLOR.ok
  if (state === "failed" || state === "preflight-failed" || state === "rollback-failed") return COLOR.bad
  if (state === "detection-disagreement") return COLOR.kev
  if (state === "missing") return COLOR.warn
  return COLOR.muted
}
