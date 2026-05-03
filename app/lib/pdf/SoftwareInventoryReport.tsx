import { Cover, Document, Page, PdfFooter, Text, View, styles, COLOR } from "./_shared"
import type { SoftwareInventoryData } from "@/lib/reports/software-inventory"

export function SoftwareInventoryReport({
  data,
  footerText,
  generatedAt,
}: {
  data: SoftwareInventoryData
  footerText: string | null
  generatedAt: Date
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Cover
          kind="Software Inventory"
          tenantName={data.tenantName}
          rangeLabel={`as of ${data.asOf.toISOString().slice(0, 10)}`}
          audience={data.audience}
          generatedAt={generatedAt}
        />

        <Text style={styles.sectionHeader}>Catalog summary</Text>
        <View style={styles.headlineRow}>
          <View style={styles.headlineCard}>
            <Text style={styles.headlineNumber}>{data.catalogSummary.totalPackages}</Text>
            <Text style={styles.headlineLabel}>Packages tracked</Text>
          </View>
          <View style={styles.headlineCard}>
            <Text style={styles.headlineNumber}>{data.catalogSummary.approvedPackages}</Text>
            <Text style={styles.headlineLabel}>Approved</Text>
          </View>
          <View style={styles.headlineCard}>
            <Text style={[styles.headlineNumber, { color: data.catalogSummary.packagesWithDrift > 0 ? COLOR.warn : COLOR.ok }]}>
              {data.catalogSummary.packagesWithDrift}
            </Text>
            <Text style={styles.headlineLabel}>Packages with drift</Text>
          </View>
          <View style={styles.headlineCard}>
            <Text style={[styles.headlineNumber, { color: data.catalogSummary.hostsOutdated > 0 ? COLOR.warn : COLOR.ok }]}>
              {data.catalogSummary.hostsOutdated}
            </Text>
            <Text style={styles.headlineLabel}>Hosts outdated</Text>
          </View>
        </View>

        {data.driftByPackage.length > 0 && (
          <View>
            <Text style={styles.sectionHeader}>Drift by package</Text>
            {data.driftByPackage.slice(0, 25).map((p) => (
              <View key={p.packageName} style={{ marginBottom: 6 }} wrap={false}>
                <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 2 }}>{p.packageName}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                  {p.versions.map((v) => (
                    <Text
                      key={v.version}
                      style={{
                        fontSize: 8,
                        paddingVertical: 1.5,
                        paddingHorizontal: 4,
                        borderRadius: 3,
                        backgroundColor: v.isApprovedDefault ? "#DCFCE7" : "#FEF3C7",
                        color: v.isApprovedDefault ? COLOR.ok : COLOR.warn,
                      }}
                    >
                      {v.version}: {v.hostCount} {v.isApprovedDefault ? "(default)" : ""}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {data.heaviestHosts.length > 0 && (
          <View wrap={false}>
            <Text style={styles.sectionHeader}>Heaviest hosts (by installed app count)</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, { width: "55%" }]}>Hostname</Text>
                <Text style={[styles.th, { width: "30%" }]}>Client</Text>
                <Text style={[styles.th, { width: "15%" }]}>Apps</Text>
              </View>
              {data.heaviestHosts.map((h) => (
                <View key={h.hostname} style={styles.tr}>
                  <Text style={[styles.td, { width: "55%", fontFamily: "Courier" }]}>{h.hostname}</Text>
                  <Text style={[styles.td, { width: "30%" }]}>{h.clientName}</Text>
                  <Text style={[styles.td, { width: "15%" }]}>{h.installedCount}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {data.perClientFootprint.length > 0 && (
          <View wrap={false}>
            <Text style={styles.sectionHeader}>Per-client footprint</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, { width: "60%" }]}>Client</Text>
                <Text style={[styles.th, { width: "20%" }]}>Hosts</Text>
                <Text style={[styles.th, { width: "20%" }]}>Avg apps</Text>
              </View>
              {data.perClientFootprint.map((c) => (
                <View key={c.clientName} style={styles.tr}>
                  <Text style={[styles.td, { width: "60%" }]}>{c.clientName}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{c.hostCount}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{c.averageInstalledCount}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {data.recentDeployments.length > 0 && (
          <View>
            <Text style={styles.sectionHeader}>Recent deployments</Text>
            <View style={styles.table}>
              <View style={[styles.tr, styles.thead]}>
                <Text style={[styles.th, { width: "30%" }]}>Package</Text>
                <Text style={[styles.th, { width: "12%" }]}>Action</Text>
                <Text style={[styles.th, { width: "20%" }]}>Requested by</Text>
                <Text style={[styles.th, { width: "12%" }]}>Started</Text>
                <Text style={[styles.th, { width: "26%" }]}>Result</Text>
              </View>
              {data.recentDeployments.map((d) => (
                <View key={d.deploymentId} style={styles.tr}>
                  <Text style={[styles.td, { width: "30%" }]}>{d.packageName}</Text>
                  <Text style={[styles.td, { width: "12%" }]}>{d.action}</Text>
                  <Text style={[styles.td, { width: "20%" }]}>{d.requestedBy}</Text>
                  <Text style={[styles.td, { width: "12%" }]}>{d.startedAt ?? "-"}</Text>
                  <Text style={[styles.td, { width: "26%" }]}>
                    {d.succeeded}/{d.totalTargets} succeeded
                    {d.failed > 0 ? `, ${d.failed} failed` : ""}
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
