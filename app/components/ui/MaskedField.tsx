"use client"
import { useState, type CSSProperties } from "react"
import { Button } from "@/components/ui/Button"

// Phase 11 WS-E.1 — sensitive-input primitive. Defaults to masked
// display (`••••••••<last4>`). Reveal toggle + copy-to-clipboard.
//
// onReveal is the disclosure-log hook: the route that fetches the
// real plaintext (POST /api/admin/credentials/[id]/disclose) is
// triggered by the parent; this primitive only renders + hides the
// already-fetched plaintext locally. For credentials, the parent
// captures the plaintext in component state at disclose-time and
// passes it here.
//
// For the "copy without reveal" flow, set `value` to the plaintext
// (silent) and `displayMasked` to the operator-visible "•••• last4".

interface Props {
  /// The current plaintext or null while not yet disclosed.
  value: string | null
  /// The masked-display fallback shown when value=null OR when the
  /// reveal toggle is off. E.g. "••••••••/9j".
  displayMasked: string
  /// Optional label/aria — read by screen readers.
  ariaLabel?: string
  /// Called when the operator clicks Reveal AND value is null —
  /// parent triggers a disclose request to fetch the plaintext.
  onReveal?: () => void | Promise<void>
  /// Called whenever the operator copies — parent can record this
  /// to the disclosure log.
  onCopy?: () => void | Promise<void>
  /// Compact (one-line) vs default (with reveal/copy buttons row).
  compact?: boolean
  style?: CSSProperties
}

export function MaskedField({
  value,
  displayMasked,
  ariaLabel,
  onReveal,
  onCopy,
  compact = false,
  style,
}: Props) {
  const [revealed, setRevealed] = useState(false)
  const showPlaintext = revealed && value != null

  async function handleReveal() {
    if (!revealed && value == null && onReveal) {
      await onReveal()
    }
    setRevealed((r) => !r)
  }

  async function handleCopy() {
    const toCopy = showPlaintext ? value ?? "" : displayMasked
    try {
      await navigator.clipboard.writeText(toCopy)
    } catch {
      // ignore — clipboard API may be blocked
    }
    if (onCopy) await onCopy()
  }

  return (
    <span
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        ...style,
      }}
    >
      <code
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 12.5,
          padding: "3px 8px",
          background: "var(--color-background-tertiary)",
          borderRadius: 4,
          minWidth: 80,
          display: "inline-block",
          wordBreak: "break-all",
        }}
      >
        {showPlaintext ? value : displayMasked}
      </code>
      {!compact && (
        <>
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onClick={handleReveal}
            title={showPlaintext ? "Hide" : "Reveal"}
            aria-label={showPlaintext ? "Hide" : "Reveal"}
          >
            {showPlaintext ? "👁 hide" : "👁 reveal"}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onClick={handleCopy}
            title="Copy"
            aria-label="Copy"
          >
            📋 copy
          </Button>
        </>
      )}
    </span>
  )
}
