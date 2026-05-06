import { Cover, Document, Page, PdfFooter, Text, View, styles, COLOR } from "./_shared"
import type { QbrData } from "@/lib/reports/qbr"

// PHASE-5-DESIGN §3.5 — Quarterly Business Review.
// Audience-gated: client = executive view; tech adds the full risk drilldown.
// ASCII-only per the Helvetica memory note (no em dashes, curly quotes, arrows).

const SECTIONS = {
  cover: ["tech", "client", "auditor"],
  narrative: ["tech", "client", "auditor"],
  headline: ["tech", "client", "auditor"],
  wins: ["tech", "client", "auditor"],
  notableDeploys: ["tech", "client", "auditor"],
  risks: ["tech", "client", "auditor"],
  identityGaps: ["tech", "auditor"],
  lookingAhead: ["tech", "client", "auditor"],
} as const

function shows(section: keyof typeof SECTIONS, audience: string): boolean {
  return (SECTIONS[section] as readonly string[]).includes(audience)
}

export function QbrReport({
  data,
  footerText,
  logoUrl,
  accentColor,
  generatedAt,
}: {
  data: QbrData
  footerText: string | null
  logoUrl?: string | null
  accentColor?: string | null
  generatedAt: Date
}) {
  return (
    <Document>
      {/* PAGE 1: Cover + executive narrative + headline metrics */}
      <Page size="LETTER" style={styles.page}>
        {shows("cover", data.audience) && (
          <Cover
            kind="Quarterly Business Review"
            tenantName={data.tenantName}
            rangeLabel={data.periodLabel}
            audience={data.audience}
            generatedAt={generatedAt}
            logoUrl={logoUrl}
            accentColor={accentColor}
          />
        )}

        {shows("narrative", data.audience) && data.narrative && (
          <View style={{ marginTop: 18 }}>
            <Text style={styles.sectionHeader}>Executive summary</Text>
            {data.narrative.split(/\n{2,}/).map((para, idx) => (
              <Text
                key={idx}
                style={{ fontSize: 10, lineHeight: 1.45, marginBottom: 8 }}
              >
                {para.trim()}
              </Text>
            ))}
          </View>
        )}

        {shows("headline", data.audience) && (
          <View>
            <Text style={styles.sectionHeader}>Headline metrics</Text>
            <View style={styles.headlineRow}>
              <View style={styles.headlineCard}>
                <Text style={styles.headlineNumber}>{data.headline.hostsManaged}</Text>
                <Text style={styles.headlineLabel}>Hosts managed</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text style={styles.headlineNumber}>{data.headline.patchesApplied}</Text>
                <Text style={styles.headlineLabel}>Patches applied</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text style={styles.headlineNumber}>{data.headline.scriptsExecuted}</Text>
                <Text style={styles.headlineLabel}>Scripts run</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text style={styles.headlineNumber}>{data.headline.deploysCompleted}</Text>
                <Text style={styles.headlineLabel}>Deploys completed</Text>
              </View>
            </View>
            <View style={styles.headlineRow}>
              <View style={styles.headlineCard}>
                <Text style={[styles.headlineNumber, { color: COLOR.ok }]}>
                  {data.headline.alertsResolved}
                </Text>
                <Text style={styles.headlineLabel}>Alerts resolved</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    { color: data.headline.hostsWithOpenPatches > 0 ? COLOR.warn : COLOR.ok },
                  ]}
                >
                  {data.headline.hostsWithOpenPatches}
                </Text>
                <Text style={styles.headlineLabel}>Hosts with open patches</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    { color: data.risks.kevExposure.length > 0 ? COLOR.bad : COLOR.ok },
                  ]}
                >
                  {data.risks.kevExposure.length}
                </Text>
                <Text style={styles.headlineLabel}>Open KEV CVEs</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    { color: data.risks.eolHosts.length > 0 ? COLOR.warn : COLOR.ok },
                  ]}
                >
                  {data.risks.eolHosts.length}
                </Text>
                <Text style={styles.headlineLabel}>End-of-life hosts</Text>
              </View>
            </View>
          </View>
        )}

        <PdfFooter tenantName={data.tenantName} footerText={footerText} />
      </Page>

      {/* PAGE 2: Wins + Notable deploys */}
      <Page size="LETTER" style={styles.page}>
        {shows("wins", data.audience) && (
          <View>
            <Text style={styles.sectionHeader}>Wins this quarter</Text>
            {data.wins.length === 0 ? (
              <Text style={{ fontSize: 9, color: COLOR.muted }}>
                No alerts resolved in this window.
              </Text>
            ) : (
              <View style={styles.table}>
                <View style={[styles.tr, styles.thead]}>
                  <Text style={[styles.th, { width: "10%" }]}>Sev</Text>
                  <Text style={[styles.th, { width: "44%" }]}>Title</Text>
                  <Text style={[styles.th, { width: "20%" }]}>Host</Text>
                  <Text style={[styles.th, { width: "13%" }]}>Resolved</Text>
                  <Text style={[styles.th, { width: "13%" }]}>Days open</Text>
                </View>
                {data.wins.map((w, idx) => (
                  <View key={idx} style={styles.tr}>
                    <Text
                      style={[
                        styles.td,
                        { width: "10%", color: sevColor(w.severity), textTransform: "capitalize" },
                      ]}
                    >
                      {w.severity}
                    </Text>
                    <Text style={[styles.td, { width: "44%" }]}>{trim(w.title, 80)}</Text>
                    <Text style={[styles.td, { width: "20%", fontFamily: "Courier" }]}>
                      {w.hostname ? trim(w.hostname, 22) : "-"}
                    </Text>
                    <Text style={[styles.td, { width: "13%" }]}>
                      {w.resolvedAt.toISOString().slice(0, 10)}
                    </Text>
                    <Text style={[styles.td, { width: "13%" }]}>{w.durationDays}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {shows("notableDeploys", data.audience) && data.notableDeploys.length > 0 && (
          <View>
            <Text style={styles.sectionHeader}>Notable deploys</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, { width: "44%" }]}>Package</Text>
                <Text style={[styles.th, { width: "18%" }]}>Completed</Text>
                <Text style={[styles.th, { width: "12%" }]}>Targets</Text>
                <Text style={[styles.th, { width: "13%" }]}>Succeeded</Text>
                <Text style={[styles.th, { width: "13%" }]}>Failed</Text>
              </View>
              {data.notableDeploys.map((d, idx) => (
                <View key={idx} style={styles.tr}>
                  <Text style={[styles.td, { width: "44%" }]}>{trim(d.packageName, 60)}</Text>
                  <Text style={[styles.td, { width: "18%" }]}>
                    {d.completedAt.toISOString().slice(0, 10)}
                  </Text>
                  <Text style={[styles.td, { width: "12%" }]}>{d.totalTargets}</Text>
                  <Text style={[styles.td, { width: "13%", color: COLOR.ok }]}>{d.succeeded}</Text>
                  <Text
                    style={[
                      styles.td,
                      { width: "13%", color: d.failed > 0 ? COLOR.bad : COLOR.muted },
                    ]}
                  >
                    {d.failed}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <PdfFooter tenantName={data.tenantName} footerText={footerText} />
      </Page>

      {/* PAGE 3: Risk areas */}
      {shows("risks", data.audience) && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionHeader}>Risk areas</Text>

          {data.risks.kevExposure.length > 0 ? (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
                Known-exploited CVEs still present
              </Text>
              <Text style={{ fontSize: 8.5, color: COLOR.muted, marginBottom: 6 }}>
                CISA Known Exploited Vulnerabilities (KEV) -- exploited in the wild.
                Top {data.risks.kevExposure.length} unpatched.
              </Text>
              <View style={styles.table}>
                <View style={[styles.tr, styles.thead]}>
                  <Text style={[styles.th, { width: "26%" }]}>CVE</Text>
                  <Text style={[styles.th, { width: "14%" }]}>CVSS</Text>
                  <Text style={[styles.th, { width: "30%" }]}>Patch</Text>
                  <Text style={[styles.th, { width: "30%" }]}>Affected hosts</Text>
                </View>
                {data.risks.kevExposure.map((k) => (
                  <View key={k.cveId} style={styles.tr}>
                    <Text style={[styles.td, { width: "26%", color: COLOR.kev }]}>
                      {k.cveId}
                    </Text>
                    <Text style={[styles.td, { width: "14%" }]}>
                      {k.cvssBase?.toFixed(1) ?? "-"}
                    </Text>
                    <Text style={[styles.td, { width: "30%", fontFamily: "Courier" }]}>
                      {trim(k.patchSourceId, 30)}
                    </Text>
                    <Text style={[styles.td, { width: "30%" }]}>{k.affectedHosts}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <Text style={{ fontSize: 9, color: COLOR.ok, marginBottom: 14 }}>
              No unpatched known-exploited CVEs in the fleet at end of period.
            </Text>
          )}

          {data.risks.eolHosts.length > 0 && (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
                End-of-life hardware and operating systems
              </Text>
              <View style={styles.table}>
                <View style={[styles.tr, styles.thead]}>
                  <Text style={[styles.th, { width: "30%" }]}>Host</Text>
                  <Text style={[styles.th, { width: "70%" }]}>Reason</Text>
                </View>
                {data.risks.eolHosts.map((h, idx) => (
                  <View key={idx} style={styles.tr}>
                    <Text style={[styles.td, { width: "30%", fontFamily: "Courier" }]}>
                      {trim(h.hostname, 28)}
                    </Text>
                    <Text style={[styles.td, { width: "70%" }]}>{h.reason}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {shows("identityGaps", data.audience) && data.risks.identityGaps.length > 0 && (
            <View>
              <Text style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
                Identity / Microsoft 365 posture
              </Text>
              {data.risks.identityGaps.map((g, idx) => (
                <Text key={idx} style={{ fontSize: 9, marginBottom: 4 }}>
                  - {g.label}: {g.detail}
                </Text>
              ))}
            </View>
          )}

          <PdfFooter tenantName={data.tenantName} footerText={footerText} />
        </Page>
      )}

      {/* PAGE 4: Looking ahead */}
      {shows("lookingAhead", data.audience) && data.lookingAhead.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionHeader}>Looking ahead</Text>
          {data.lookingAhead.map((l, idx) => (
            <View
              key={idx}
              style={{
                marginBottom: 8,
                padding: 8,
                borderWidth: 0.5,
                borderColor: COLOR.rule,
                borderRadius: 4,
                backgroundColor: "#F8FAFC",
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: 700 }}>{l.label}</Text>
              <Text style={{ fontSize: 9, color: COLOR.muted, marginTop: 2 }}>
                {l.detail}
              </Text>
            </View>
          ))}
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

function sevColor(severity: string): string {
  switch (severity) {
    case "critical": return COLOR.bad
    case "warn": return COLOR.warn
    default: return COLOR.muted
  }
}
