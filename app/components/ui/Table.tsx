import type { CSSProperties, ReactNode, TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from "react"
import { TYPOGRAPHY } from "@/lib/ui-tokens"

// Phase 11 WS-E.1 — canonical table primitives. The Phase-10 audit
// found 25+ raw <table> blocks each redefining their own thStyle /
// tdStyle with drifting fontSize (12 / 12.5 / 13). Adoption is
// opt-in: a route migrates by replacing <table>/<th>/<td> with
// <DataTable>/<TH>/<TD>. Existing inline-style call sites keep
// working — this primitive is additive, not breaking.
//
// Canonical shape (12.5px body, 11px caps thead, 0.5px borders) is
// borrowed from the most-common drift target in the audit.

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode
  /// Stripe alternate rows. Subtle background, easier to scan.
  striped?: boolean
}

export function DataTable({ children, striped, style, ...rest }: TableProps) {
  const composed: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12.5,
    fontFamily: "inherit",
    ...style,
  }
  return (
    <table
      {...rest}
      style={composed}
      data-striped={striped ? "1" : undefined}
    >
      {children}
    </table>
  )
}

interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode
}

export function TH({ children, style, ...rest }: THProps) {
  const composed: CSSProperties = {
    ...TYPOGRAPHY.LABEL_CAPS,
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    background: "var(--color-background-secondary)",
    whiteSpace: "nowrap",
    ...style,
  }
  return <th {...rest} style={composed}>{children}</th>
}

interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode
}

export function TD({ children, style, ...rest }: TDProps) {
  const composed: CSSProperties = {
    padding: "8px 10px",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    verticalAlign: "middle",
    ...style,
  }
  return <td {...rest} style={composed}>{children}</td>
}
