import { Cover, Document, Page, PdfFooter, Text, View, styles, COLOR } from "./_shared"
import type { IdentityPostureData } from "@/lib/reports/identity-posture"

// PHASE-5-DESIGN §3.4 — Identity Posture (Scout-backed).
// Audience-gated: client sees the headline + summary issues; tech/auditor
// also see the per-policy CA table, the lowest-scoring controls, and the
// per-user samples. ASCII-only per the Helvetica memory note.

const SECTIONS = {
  cover: ["tech", "client", "auditor"],
  summary: ["tech", "client", "auditor"],
  headline: ["tech", "client", "auditor"],
  admins: ["tech", "client", "auditor"],
  mfa: ["tech", "client", "auditor"],
  secureScore: ["tech", "client", "auditor"],
  conditionalAccess: ["tech", "client", "auditor"],
  caPolicyTable: ["tech", "auditor"],
  staleUsers: ["tech", "client", "auditor"],
  staleSampleTable: ["tech", "auditor"],
  controlSamples: ["tech", "auditor"],
} as const

function shows(section: keyof typeof SECTIONS, audience: string): boolean {
  return (SECTIONS[section] as readonly string[]).includes(audience)
}

export function IdentityPostureReport({
  data,
  footerText,
  generatedAt,
}: {
  data: IdentityPostureData
  footerText: string | null
  generatedAt: Date
}) {
  const rangeLabel = data.runAt
    ? `Scout audit ${data.runAt.toISOString().slice(0, 10)}`
    : `as of ${data.asOf.toISOString().slice(0, 10)}`

  // Empty-state path — render a single-page explainer instead of the full report.
  if (data.status !== "ok" || !data.results) {
    return (
      <Document>
        <Page size="LETTER" style={styles.page}>
          <Cover
            kind="Identity Posture"
            tenantName={data.tenantName}
            rangeLabel={rangeLabel}
            audience={data.audience}
            generatedAt={generatedAt}
          />
          <View style={{ marginTop: 18 }}>
            <Text style={styles.sectionHeader}>Audit unavailable</Text>
            <Text style={{ fontSize: 10, lineHeight: 1.45, marginBottom: 8 }}>
              {data.statusMessage}
            </Text>
            {data.prospect && (
              <Text style={{ fontSize: 9, color: COLOR.muted, marginTop: 6 }}>
                Scout prospect: {data.prospect.name} ({data.prospect.slug})
              </Text>
            )}
          </View>
          <PdfFooter tenantName={data.tenantName} footerText={footerText} />
        </Page>
      </Document>
    )
  }

  const r = data.results

  return (
    <Document>
      {/* PAGE 1: Cover + headline + summary issues */}
      <Page size="LETTER" style={styles.page}>
        {shows("cover", data.audience) && (
          <Cover
            kind="Identity Posture"
            tenantName={data.tenantName}
            rangeLabel={rangeLabel}
            audience={data.audience}
            generatedAt={generatedAt}
          />
        )}

        {shows("summary", data.audience) && r.summary.headlineIssues.length > 0 && (
          <View>
            <Text style={styles.sectionHeader}>Issues to address</Text>
            {r.summary.headlineIssues.map((issue, idx) => (
              <Text key={idx} style={{ fontSize: 10, marginBottom: 3 }}>
                - {issue}
              </Text>
            ))}
          </View>
        )}

        {shows("summary", data.audience) && r.summary.headlineIssues.length === 0 && (
          <Text style={{ fontSize: 10, color: COLOR.ok, marginTop: 6 }}>
            No headline issues flagged. Tenant matches identity baseline.
          </Text>
        )}

        {shows("headline", data.audience) && (
          <View>
            <Text style={styles.sectionHeader}>Headline</Text>
            <View style={styles.headlineRow}>
              <View style={styles.headlineCard}>
                <Text style={styles.headlineNumber}>{r.users.total}</Text>
                <Text style={styles.headlineLabel}>Total users</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    {
                      color:
                        r.mfa.available && r.mfa.membersRegisteredPct >= 95
                          ? COLOR.ok
                          : r.mfa.membersRegisteredPct >= 75
                            ? COLOR.warn
                            : COLOR.bad,
                    },
                  ]}
                >
                  {r.mfa.available ? `${r.mfa.membersRegisteredPct}%` : "n/a"}
                </Text>
                <Text style={styles.headlineLabel}>Members with MFA</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    {
                      color:
                        r.admins.available && r.admins.inBestPracticeBand
                          ? COLOR.ok
                          : COLOR.warn,
                    },
                  ]}
                >
                  {r.admins.available ? r.admins.count : "n/a"}
                </Text>
                <Text style={styles.headlineLabel}>Global admins</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    {
                      color:
                        r.secureScore.available && r.secureScore.pct != null && r.secureScore.pct >= 50
                          ? COLOR.ok
                          : r.secureScore.available
                            ? COLOR.bad
                            : COLOR.muted,
                    },
                  ]}
                >
                  {r.secureScore.available && r.secureScore.pct != null
                    ? `${r.secureScore.pct}%`
                    : "n/a"}
                </Text>
                <Text style={styles.headlineLabel}>Secure score</Text>
              </View>
            </View>
            <View style={styles.headlineRow}>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    { color: r.users.staleCrit > 0 ? COLOR.bad : r.users.staleWarn > 0 ? COLOR.warn : COLOR.ok },
                  ]}
                >
                  {r.users.staleCrit}
                </Text>
                <Text style={styles.headlineLabel}>Stale 180+ days</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    { color: r.users.disabledLicensed > 0 ? COLOR.warn : COLOR.ok },
                  ]}
                >
                  {r.users.disabledLicensed}
                </Text>
                <Text style={styles.headlineLabel}>Disabled, still licensed</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text
                  style={[
                    styles.headlineNumber,
                    {
                      color: r.conditionalAccess.available && r.conditionalAccess.enabled > 0 ? COLOR.ok : COLOR.warn,
                    },
                  ]}
                >
                  {r.conditionalAccess.available ? r.conditionalAccess.enabled : "n/a"}
                </Text>
                <Text style={styles.headlineLabel}>CA policies enabled</Text>
              </View>
              <View style={styles.headlineCard}>
                <Text style={styles.headlineNumber}>{r.users.guests}</Text>
                <Text style={styles.headlineLabel}>Guest accounts</Text>
              </View>
            </View>
          </View>
        )}

        <PdfFooter tenantName={data.tenantName} footerText={footerText} />
      </Page>

      {/* PAGE 2: Admins + MFA + Conditional Access */}
      <Page size="LETTER" style={styles.page}>
        {shows("admins", data.audience) && r.admins.available && (
          <View>
            <Text style={styles.sectionHeader}>Global administrators ({r.admins.count})</Text>
            {!r.admins.inBestPracticeBand && (
              <Text style={{ fontSize: 9, color: COLOR.warn, marginBottom: 4 }}>
                Best practice: 2 to 5 Global Administrators (one for break-glass).
              </Text>
            )}
            {r.admins.globalAdmins.length === 0 ? (
              <Text style={{ fontSize: 9, color: COLOR.muted }}>
                No Global Administrators returned by directoryRoles.
              </Text>
            ) : (
              <View style={styles.table}>
                <View style={[styles.tr, styles.thead]}>
                  <Text style={[styles.th, { width: "40%" }]}>UPN</Text>
                  <Text style={[styles.th, { width: "30%" }]}>Display name</Text>
                  <Text style={[styles.th, { width: "15%" }]}>Last sign-in</Text>
                  <Text style={[styles.th, { width: "15%" }]}>Days</Text>
                </View>
                {r.admins.globalAdmins.map((a) => (
                  <View key={a.id} style={styles.tr}>
                    <Text style={[styles.td, { width: "40%", fontFamily: "Courier" }]}>
                      {trim(a.upn, 50)}
                    </Text>
                    <Text style={[styles.td, { width: "30%" }]}>
                      {trim(a.displayName ?? "-", 38)}
                    </Text>
                    <Text style={[styles.td, { width: "15%" }]}>
                      {a.lastSignIn ? a.lastSignIn.slice(0, 10) : "never"}
                    </Text>
                    <Text style={[styles.td, { width: "15%" }]}>
                      {a.daysSinceSignIn ?? "-"}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {shows("mfa", data.audience) && r.mfa.available && (
          <View>
            <Text style={styles.sectionHeader}>MFA coverage</Text>
            <Text style={{ fontSize: 10, marginBottom: 4 }}>
              Members: {r.mfa.membersRegistered} of {r.mfa.membersAssessed} registered ({r.mfa.membersRegisteredPct}%).
              Admins: {r.mfa.adminsRegistered} of {r.mfa.adminsAssessed} ({r.mfa.adminsRegisteredPct}%).
            </Text>
            {r.mfa.adminsWithoutMfa.length > 0 && (
              <View>
                <Text style={{ fontSize: 9, color: COLOR.bad, marginTop: 4, marginBottom: 4 }}>
                  Admins without MFA registered:
                </Text>
                <View style={styles.table}>
                  <View style={[styles.tr, styles.thead]}>
                    <Text style={[styles.th, { width: "55%" }]}>UPN</Text>
                    <Text style={[styles.th, { width: "45%" }]}>Display name</Text>
                  </View>
                  {r.mfa.adminsWithoutMfa.map((a) => (
                    <View key={a.id} style={styles.tr}>
                      <Text style={[styles.td, { width: "55%", fontFamily: "Courier" }]}>
                        {trim(a.upn, 60)}
                      </Text>
                      <Text style={[styles.td, { width: "45%" }]}>
                        {trim(a.displayName ?? "-", 50)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {shows("conditionalAccess", data.audience) && (
          <View>
            <Text style={styles.sectionHeader}>Conditional Access</Text>
            {!r.conditionalAccess.available ? (
              <Text style={{ fontSize: 9, color: COLOR.muted }}>
                Conditional Access not licensed (Entra ID P1 or higher required).
                {r.conditionalAccess.reason ? ` Reason: ${r.conditionalAccess.reason}` : ""}
              </Text>
            ) : (
              <View>
                <Text style={{ fontSize: 10, marginBottom: 4 }}>
                  {r.conditionalAccess.enabled} enabled / {r.conditionalAccess.reportOnly} report-only / {r.conditionalAccess.disabled} disabled.
                </Text>
                <Text style={{ fontSize: 9, marginBottom: 2 }}>
                  - Require MFA on admins: {r.conditionalAccess.requireMfaForAdmins ? "yes" : "no"}
                </Text>
                <Text style={{ fontSize: 9, marginBottom: 2 }}>
                  - Require MFA on all users: {r.conditionalAccess.requireMfaAllUsers ? "yes" : "no"}
                </Text>
                <Text style={{ fontSize: 9, marginBottom: 2 }}>
                  - Block legacy auth: {r.conditionalAccess.blockLegacyAuth ? "yes" : "no"}
                </Text>
              </View>
            )}
          </View>
        )}

        <PdfFooter tenantName={data.tenantName} footerText={footerText} />
      </Page>

      {/* PAGE 3 (tech/auditor): CA policy table + Secure Score lowest controls */}
      {(shows("caPolicyTable", data.audience) || shows("controlSamples", data.audience)) && (
        <Page size="LETTER" style={styles.page}>
          {shows("caPolicyTable", data.audience) && r.conditionalAccess.available && r.conditionalAccess.policies.length > 0 && (
            <View>
              <Text style={styles.sectionHeader}>Conditional Access policies</Text>
              <View style={styles.table}>
                <View style={[styles.tr, styles.thead]}>
                  <Text style={[styles.th, { width: "55%" }]}>Display name</Text>
                  <Text style={[styles.th, { width: "15%" }]}>State</Text>
                  <Text style={[styles.th, { width: "15%" }]}>MFA</Text>
                  <Text style={[styles.th, { width: "15%" }]}>Block legacy</Text>
                </View>
                {r.conditionalAccess.policies.slice(0, 30).map((p) => (
                  <View key={p.id} style={styles.tr}>
                    <Text style={[styles.td, { width: "55%" }]}>{trim(p.displayName, 70)}</Text>
                    <Text
                      style={[
                        styles.td,
                        { width: "15%", color: stateColor(p.state) },
                      ]}
                    >
                      {p.state}
                    </Text>
                    <Text style={[styles.td, { width: "15%", color: p.requiresMfa ? COLOR.ok : COLOR.muted }]}>
                      {p.requiresMfa ? "yes" : "-"}
                    </Text>
                    <Text style={[styles.td, { width: "15%", color: p.blocksLegacyAuth ? COLOR.ok : COLOR.muted }]}>
                      {p.blocksLegacyAuth ? "yes" : "-"}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {shows("controlSamples", data.audience) && r.secureScore.available && r.secureScore.lowestControls.length > 0 && (
            <View>
              <Text style={styles.sectionHeader}>Lowest-scoring Secure Score controls</Text>
              <View style={styles.table}>
                <View style={[styles.tr, styles.thead]}>
                  <Text style={[styles.th, { width: "30%" }]}>Control</Text>
                  <Text style={[styles.th, { width: "20%" }]}>Category</Text>
                  <Text style={[styles.th, { width: "10%" }]}>Score</Text>
                  <Text style={[styles.th, { width: "40%" }]}>Description</Text>
                </View>
                {r.secureScore.lowestControls.map((c, idx) => (
                  <View key={idx} style={styles.tr}>
                    <Text style={[styles.td, { width: "30%" }]}>{trim(c.name, 36)}</Text>
                    <Text style={[styles.td, { width: "20%" }]}>{trim(c.category, 24)}</Text>
                    <Text style={[styles.td, { width: "10%" }]}>{c.score}</Text>
                    <Text style={[styles.td, { width: "40%" }]}>{trim(c.description, 130)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <PdfFooter tenantName={data.tenantName} footerText={footerText} />
        </Page>
      )}

      {/* PAGE 4 (tech/auditor): Stale users sample */}
      {shows("staleSampleTable", data.audience) && r.users.staleSample.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionHeader}>Stale member accounts</Text>
          <Text style={{ fontSize: 9, color: COLOR.muted, marginBottom: 6 }}>
            Members enabled but not signed in for 90+ days. Top {r.users.staleSample.length} by inactivity.
          </Text>
          <View style={styles.table}>
            <View style={[styles.tr, styles.thead]}>
              <Text style={[styles.th, { width: "45%" }]}>UPN</Text>
              <Text style={[styles.th, { width: "30%" }]}>Display name</Text>
              <Text style={[styles.th, { width: "15%" }]}>Last sign-in</Text>
              <Text style={[styles.th, { width: "10%" }]}>Days</Text>
            </View>
            {r.users.staleSample.map((u) => (
              <View key={u.id} style={styles.tr}>
                <Text style={[styles.td, { width: "45%", fontFamily: "Courier" }]}>
                  {trim(u.upn, 56)}
                </Text>
                <Text style={[styles.td, { width: "30%" }]}>
                  {trim(u.displayName ?? "-", 36)}
                </Text>
                <Text style={[styles.td, { width: "15%" }]}>
                  {u.lastSignIn ? u.lastSignIn.slice(0, 10) : "never"}
                </Text>
                <Text style={[styles.td, { width: "10%" }]}>
                  {u.daysSinceSignIn ?? "-"}
                </Text>
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

function stateColor(state: string): string {
  if (state === "enabled") return COLOR.ok
  if (state === "enabledForReportingButNotEnforced") return COLOR.warn
  return COLOR.muted
}
