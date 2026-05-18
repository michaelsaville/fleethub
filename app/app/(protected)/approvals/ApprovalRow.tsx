"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { InlineAlert } from "@/components/ui/InlineAlert"
import { FIELD } from "@/lib/ui-tokens"

interface ApprovalRowProps {
  approval: {
    id: string
    action: string
    tenantName: string
    payloadJson: string
    requestedBy: string
    requestedAt: string
    scope: string | null
    state: string
    expiresAt: string
    approverEmail: string | null
  }
  isAdmin: boolean
  viewerEmail: string
}

export default function ApprovalRow({
  approval,
  isAdmin,
  viewerEmail,
}: ApprovalRowProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showDeny, setShowDeny] = useState(false)
  const [denyReason, setDenyReason] = useState("")
  const [showPayload, setShowPayload] = useState(false)

  const isOwn = approval.requestedBy === viewerEmail
  const canDecide = isAdmin && !isOwn && approval.state === "pending"
  const consumedWaiting = approval.state === "approved"

  async function decide(decision: "approve" | "deny") {
    setError(null)
    const body =
      decision === "approve"
        ? { decision }
        : { decision, reason: denyReason.trim() || "no reason provided" }
    const res = await fetch(`/api/approvals/${approval.id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? `HTTP ${res.status}`)
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <li
      style={{
        padding: "10px 12px",
        background: "var(--color-background-tertiary)",
        borderRadius: 6,
        border: "0.5px solid var(--color-border-tertiary)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            background: consumedWaiting
              ? "var(--color-tone-info-bg, #dbeafe)"
              : "var(--color-tone-warn-bg, #fef3c7)",
            color: consumedWaiting
              ? "var(--color-tone-info-text, #1e3a8a)"
              : "var(--color-tone-warn-text, #78350f)",
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: "uppercase",
            borderRadius: 999,
          }}
        >
          {approval.state}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{approval.action}</span>
        <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
          {approval.tenantName}
          {approval.scope ? ` · ${approval.scope}` : ""}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--color-text-muted)",
          }}
        >
          requested {new Date(approval.requestedAt).toLocaleString()}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
        From <strong>{approval.requestedBy}</strong>
        {approval.approverEmail ? <> · approved by {approval.approverEmail}</> : null}
        {" · "}
        <button
          type="button"
          onClick={() => setShowPayload((v) => !v)}
          style={{
            background: "none",
            border: 0,
            color: "var(--color-text-accent)",
            cursor: "pointer",
            padding: 0,
            fontSize: 12,
            textDecoration: "underline dotted",
          }}
        >
          {showPayload ? "hide payload" : "show payload"}
        </button>
      </div>
      {showPayload && (
        <pre
          style={{
            fontSize: 11,
            background: "var(--color-background-secondary)",
            padding: 8,
            borderRadius: 4,
            overflow: "auto",
            maxHeight: 200,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
        >
          {JSON.stringify(JSON.parse(approval.payloadJson), null, 2)}
        </pre>
      )}
      {canDecide && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="primary" onClick={() => decide("approve")} disabled={pending}>
            Approve
          </Button>
          {!showDeny ? (
            <Button variant="secondary" onClick={() => setShowDeny(true)} disabled={pending}>
              Deny…
            </Button>
          ) : (
            <>
              <input
                type="text"
                placeholder="reason"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                style={{ ...FIELD, flex: 1, minWidth: 200 }}
              />
              <Button variant="danger" onClick={() => decide("deny")} disabled={pending}>
                Confirm deny
              </Button>
              <Button variant="secondary" onClick={() => setShowDeny(false)} disabled={pending}>
                Cancel
              </Button>
            </>
          )}
        </div>
      )}
      {isOwn && approval.state === "pending" && (
        <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          Awaiting another admin to approve.
        </div>
      )}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </li>
  )
}
