/**
 * Surfaces "you're looking at synthetic data" without making it loud
 * enough to obscure the page. Auto-disappears the moment the live
 * table has its first row (callers control mounting).
 */
export default function SeedBanner({ kind }: { kind: "fleet" | "device" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 14px",
        background: "var(--color-background-secondary)",
        border: "0.5px dashed var(--color-warning)",
        borderRadius: "8px",
        fontSize: "12px",
        color: "var(--color-text-secondary)",
      }}
    >
      <span aria-hidden style={{ fontSize: "13px" }}>🧪</span>
      <div style={{ flex: 1 }}>
        <strong style={{ color: "var(--color-warning)", fontWeight: 600 }}>Seed data</strong>{" "}
        — {kind === "fleet"
          ? "no agents have enrolled yet, so this list shows the synthetic fleet from "
          : "this device is from the synthetic fleet in "}
        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px" }}>
          lib/mock-fleet.ts
        </code>
        . The fallback shuts off the moment the first agent enrolls; nothing here will appear in production once <code style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "11px" }}>fl_devices</code> has rows.
      </div>
    </div>
  )
}
