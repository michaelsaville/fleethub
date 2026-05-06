import "server-only"

// Microsoft 365 Graph app-only mailer for FleetHub. Mirrors the pattern
// in TicketHub's lib/m365.ts (Mail.Send Application permission on the
// shared Entra app registration). Per PHASE-5-DESIGN §5, scheduled report
// delivery reuses the existing M365 mail surface — same client cred grant
// against AZURE_AD_TENANT_ID/AZURE_AD_CLIENT_ID/AZURE_AD_CLIENT_SECRET.
//
// Activation:
//   1. Mail.Send (Application) granted with admin consent (one-time, done
//      for TicketHub already).
//   2. M365_SENDER_UPN=<mailbox-to-send-from> in fleethub/.env (e.g.
//      noreply@pcc2k.com or reuse helpdesk@pcc2k.com).
//   3. Restrict the app to that mailbox via Exchange ApplicationAccessPolicy
//      so a compromised FleetHub container can't impersonate other users.

interface TokenCache {
  accessToken: string
  expiresAt: number
}
let cachedToken: TokenCache | null = null

export function m365Configured(): boolean {
  return Boolean(
    process.env.AZURE_AD_TENANT_ID &&
      process.env.AZURE_AD_CLIENT_ID &&
      process.env.AZURE_AD_CLIENT_SECRET &&
      process.env.M365_SENDER_UPN,
  )
}

async function getAppOnlyToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken
  }
  const tenantId = process.env.AZURE_AD_TENANT_ID!
  const clientId = process.env.AZURE_AD_CLIENT_ID!
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET!
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token endpoint ${res.status}: ${text.slice(0, 200)}`)
  }
  const j = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    accessToken: j.access_token,
    expiresAt: Date.now() + j.expires_in * 1000,
  }
  return j.access_token
}

export interface SendReportEmailInput {
  to: string[]
  cc?: string[]
  subject: string
  htmlBody: string
  pdfBytes: Buffer
  pdfFilename: string
}

/**
 * Send a generated report PDF as an attachment via Graph sendMail.
 * Throws on failure — caller should catch + write to Fl_Report.failureReason
 * + Fl_ReportSchedule.lastError.
 */
export async function sendReportEmail(input: SendReportEmailInput): Promise<void> {
  if (!m365Configured()) {
    throw new Error(
      "M365 not configured (need AZURE_AD_* + M365_SENDER_UPN). Schedule cannot deliver.",
    )
  }
  const token = await getAppOnlyToken()
  const sender = process.env.M365_SENDER_UPN!
  const payload = {
    message: {
      subject: input.subject,
      body: { contentType: "HTML", content: input.htmlBody },
      toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
      ccRecipients: (input.cc ?? []).map((address) => ({ emailAddress: { address } })),
      attachments: [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: input.pdfFilename,
          contentType: "application/pdf",
          contentBytes: input.pdfBytes.toString("base64"),
        },
      ],
    },
    saveToSentItems: true,
  }
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph sendMail ${res.status}: ${text.slice(0, 300)}`)
  }
}
