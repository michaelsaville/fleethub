import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"

// Shared report PDF chrome. ASCII-only — Helvetica's bundled glyph set
// silently corrupts arrows + curly quotes per the @react-pdf memory note.
//
// Color tokens mirror the FleetHub UI accents but stay subdued for print.

export const COLOR = {
  ink: "#0F172A",
  muted: "#64748B",
  rule: "#CBD5E1",
  band: "#E2E8F0",
  ok: "#15803D",
  warn: "#B45309",
  bad: "#B91C1C",
  kev: "#7F1D1D",
}

export const styles = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    color: COLOR.ink,
    paddingTop: 36,
    paddingBottom: 50,
    paddingHorizontal: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    lineHeight: 1.3,
  },
  // Cover
  coverWrap: { paddingTop: 80 },
  coverTitle: { fontSize: 28, fontWeight: 700, marginBottom: 6 },
  coverKind: { fontSize: 11, color: COLOR.muted, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 24 },
  coverMeta: { fontSize: 10, color: COLOR.muted, marginBottom: 4 },
  // Section
  sectionHeader: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLOR.rule,
    borderBottomStyle: "solid",
  },
  // Headline grid
  headlineRow: { flexDirection: "row", marginBottom: 12, gap: 10 },
  headlineCard: {
    flex: 1,
    padding: 8,
    borderWidth: 0.5,
    borderColor: COLOR.rule,
    borderRadius: 4,
    backgroundColor: "#F8FAFC",
  },
  headlineNumber: { fontSize: 18, fontWeight: 700 },
  headlineLabel: { fontSize: 8, color: COLOR.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  // Tables
  table: { borderTopWidth: 0.5, borderTopColor: COLOR.rule, borderTopStyle: "solid" },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.rule,
    borderBottomStyle: "solid",
    paddingVertical: 4,
  },
  thead: { backgroundColor: COLOR.band },
  th: {
    fontSize: 7.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    color: COLOR.muted,
    paddingHorizontal: 4,
  },
  td: { fontSize: 8.5, paddingHorizontal: 4 },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: COLOR.muted,
  },
  pageNumber: { textAlign: "right" },
})

export function PdfFooter({ tenantName, footerText }: { tenantName: string; footerText: string | null }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        {footerText ?? `${tenantName} - Confidential - FleetHub generated`}
      </Text>
      <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

export function Cover({
  kind,
  tenantName,
  rangeLabel,
  audience,
  generatedAt,
}: {
  kind: string
  tenantName: string
  rangeLabel: string
  audience: string
  generatedAt: Date
}) {
  return (
    <View style={styles.coverWrap}>
      <Text style={styles.coverKind}>{kind}</Text>
      <Text style={styles.coverTitle}>{tenantName}</Text>
      <Text style={styles.coverMeta}>{rangeLabel}</Text>
      <Text style={styles.coverMeta}>Audience: {audience}</Text>
      <Text style={styles.coverMeta}>
        Generated {generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
      </Text>
    </View>
  )
}

export { Document, Page, Text, View }
