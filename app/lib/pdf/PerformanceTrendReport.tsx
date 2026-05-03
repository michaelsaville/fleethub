import { Cover, Document, Page, PdfFooter, Text, View, styles, COLOR } from "./_shared"
import type { PerformanceTrendData } from "@/lib/reports/performance-trend"

// PHASE-5-DESIGN §3.3 PDF render. ASCII-only per the Helvetica memory note.
// No SVG charts in v1; the trend "chart" is a per-day table that the client
// can paste into a deck or the auditor can verify column-by-column. Phase
// 5.5 layers a real sparkline via SVG.

export function PerformanceTrendReport({
  data,
  footerText,
  generatedAt,
}: {
  data: PerformanceTrendData
  footerText: string | null
  generatedAt: Date
}) {
  const rangeLabel = `${data.startDate.toISOString().slice(0, 10)} -> ${data.endDate.toISOString().slice(0, 10)}`

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Cover
          kind="Performance Trend"
          tenantName={data.tenantName}
          rangeLabel={rangeLabel}
          audience={data.audience}
          generatedAt={generatedAt}
        />

        <Text style={styles.sectionHeader}>Fleet health</Text>
        <View style={styles.headlineRow}>
          <View style={styles.headlineCard}>
            <Text style={styles.headlineNumber}>{data.fleetHealth.totalHosts}</Text>
            <Text style={styles.headlineLabel}>Total hosts</Text>
          </View>
          <View style={styles.headlineCard}>
            <Text style={[styles.headlineNumber, { color: data.fleetHealth.sustainedHighCpu > 0 ? COLOR.warn : COLOR.ok }]}>
              {data.fleetHealth.sustainedHighCpu}
            </Text>
            <Text style={styles.headlineLabel}>Sustained CPU &gt; 80%</Text>
          </View>
          <View style={styles.headlineCard}>
            <Text style={[styles.headlineNumber, { color: data.fleetHealth.sustainedHighRam > 0 ? COLOR.warn : COLOR.ok }]}>
              {data.fleetHealth.sustainedHighRam}
            </Text>
            <Text style={styles.headlineLabel}>Sustained RAM &gt; 90%</Text>
          </View>
          <View style={styles.headlineCard}>
            <Text style={[styles.headlineNumber, { color: data.fleetHealth.sustainedHighDisk > 0 ? COLOR.bad : COLOR.ok }]}>
              {data.fleetHealth.sustainedHighDisk}
            </Text>
            <Text style={styles.headlineLabel}>Disk &gt; 90%</Text>
          </View>
        </View>
        {data.fleetHealth.monitoringGaps > 0 && (
          <Text style={{ fontSize: 8.5, color: COLOR.warn, marginBottom: 10 }}>
            {data.fleetHealth.monitoringGaps} host(s) had monitoring gaps in this window —
            heartbeat misses reduce confidence in the percentages above.
          </Text>
        )}

        <Text style={styles.sectionHeader}>Trend</Text>
        {data.trendByDay.length === 0 ? (
          <Text style={{ fontSize: 9, color: COLOR.muted }}>
            No daily samples in window. Hourly rollup runs every hour;
            daily rollup runs at 00:05 UTC. Wait at least one full day after
            agent enrollment for the first daily row to populate.
          </Text>
        ) : (
          <View style={styles.table}>
            <View style={[styles.tr, styles.thead]}>
              <Text style={[styles.th, { width: "20%" }]}>Date</Text>
              <Text style={[styles.th, { width: "20%" }]}>CPU avg</Text>
              <Text style={[styles.th, { width: "20%" }]}>RAM avg</Text>
              <Text style={[styles.th, { width: "20%" }]}>Disk avg</Text>
              <Text style={[styles.th, { width: "20%" }]}>Hosts</Text>
            </View>
            {data.trendByDay.slice(0, 35).map((d) => (
              <View key={d.date} style={styles.tr}>
                <Text style={[styles.td, { width: "20%", fontFamily: "Courier" }]}>{d.date}</Text>
                <Text style={[styles.td, { width: "20%", color: pctColor(d.cpuAvg, 80) }]}>
                  {d.cpuAvg.toFixed(1)}%
                </Text>
                <Text style={[styles.td, { width: "20%", color: pctColor(d.ramAvg, 90) }]}>
                  {d.ramAvg.toFixed(1)}%
                </Text>
                <Text style={[styles.td, { width: "20%", color: pctColor(d.diskAvg, 90) }]}>
                  {d.diskAvg.toFixed(1)}%
                </Text>
                <Text style={[styles.td, { width: "20%" }]}>{d.hostCount}</Text>
              </View>
            ))}
          </View>
        )}

        {data.pressureList.length > 0 && (
          <View>
            <Text style={styles.sectionHeader}>Pressure list (top hosts by hours over threshold)</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, { width: "30%" }]}>Host</Text>
                <Text style={[styles.th, { width: "20%" }]}>Client</Text>
                <Text style={[styles.th, { width: "12%" }]}>Samples</Text>
                <Text style={[styles.th, { width: "12%" }]}>CPU h</Text>
                <Text style={[styles.th, { width: "13%" }]}>RAM h</Text>
                <Text style={[styles.th, { width: "13%" }]}>Disk h</Text>
              </View>
              {data.pressureList.map((h) => (
                <View key={`${h.hostname}|${h.clientName}`} style={styles.tr}>
                  <Text style={[styles.td, { width: "30%", fontFamily: "Courier" }]}>{trim(h.hostname, 28)}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{h.clientName}</Text>
                  <Text style={[styles.td, { width: "12%", color: COLOR.muted }]}>{h.samples}</Text>
                  <Text style={[styles.td, { width: "12%", color: h.cpuHoursOver > 0 ? COLOR.warn : COLOR.muted }]}>
                    {h.cpuHoursOver}
                  </Text>
                  <Text style={[styles.td, { width: "13%", color: h.ramHoursOver > 0 ? COLOR.warn : COLOR.muted }]}>
                    {h.ramHoursOver}
                  </Text>
                  <Text style={[styles.td, { width: "13%", color: h.diskHoursOver > 0 ? COLOR.bad : COLOR.muted }]}>
                    {h.diskHoursOver}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {data.eolHosts.length > 0 && (
          <View wrap={false}>
            <Text style={styles.sectionHeader}>EOL / lifecycle aging</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, { width: "30%" }]}>Host</Text>
                <Text style={[styles.th, { width: "20%" }]}>Client</Text>
                <Text style={[styles.th, { width: "20%" }]}>OS</Text>
                <Text style={[styles.th, { width: "10%" }]}>Age</Text>
                <Text style={[styles.th, { width: "20%" }]}>Reason</Text>
              </View>
              {data.eolHosts.slice(0, 30).map((h) => (
                <View key={`${h.hostname}|${h.clientName}`} style={styles.tr}>
                  <Text style={[styles.td, { width: "30%", fontFamily: "Courier" }]}>{trim(h.hostname, 28)}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{h.clientName}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{trim(h.osVersion ?? h.os ?? "-", 22)}</Text>
                  <Text style={[styles.td, { width: "10%", color: COLOR.muted }]}>
                    {h.hardwareAgeYears != null ? `${h.hardwareAgeYears}y` : "-"}
                  </Text>
                  <Text style={[styles.td, { width: "20%", color: COLOR.warn }]}>
                    {trim(h.eolReason, 40)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <PdfFooter tenantName={data.tenantName} footerText={footerText} />
      </Page>
    </Document>
  )
}

function pctColor(value: number, threshold: number): string {
  if (value >= threshold) return COLOR.bad
  if (value >= threshold * 0.85) return COLOR.warn
  return COLOR.ink
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "."
}
