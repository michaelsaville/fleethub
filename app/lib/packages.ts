import "server-only"
import { prisma } from "@/lib/prisma"
import { writeAudit } from "@/lib/audit"

// Package catalog helpers — Phase 3.
//
// Cross-source unification: Chrome on Windows is one Fl_Package row
// even when sourceable from winget OR choco. The `source` column
// records the PRIMARY source the agent uses; fallbacks live in agent-
// side logic (try winget; if not found, fall back to choco).
//
// Custom packages: source="custom", sourceId="custom:<cuid>", artifact
// stored at Fl_PackageVersion.artifactUrl. Server-side parsing of the
// uploaded MSI / PKG / DEB stubbed today (real parsing needs `msiinfo`
// / `pkgutil` / `dpkg-deb` in the container — out of scope for v1).

export interface PackageDetectionRule {
  kind:
    | "msi-product-code"
    | "registry-uninstall-key"
    | "file-version"
    | "winget-list"
    | "brew-list"
    | "custom-script"
  productCode?: string
  upgradeCode?: string
  displayName?: string
  path?: string
  minVersion?: string
  packageId?: string
  formula?: string
  script?: string
}

export interface CreatePackageInput {
  tenantName: string
  name: string
  category?: string | null
  source: "winget" | "choco" | "brew" | "custom"
  sourceId: string
  os: "windows" | "macos" | "linux" | "any"
  scope?: "machine" | "user"
  rebootPolicy?: string
  silentInstallArgs?: string | null
  silentUninstallArgs?: string | null
  detectionRule?: PackageDetectionRule
  /** Custom only: provide initial version + artifact URL. */
  initialVersion?: {
    version: string
    artifactUrl?: string | null
    artifactSha256?: string | null
    bodyEd25519Sig?: string | null
  }
  createdBy: string
}

export async function createPackage(input: CreatePackageInput) {
  const pkg = await prisma.fl_Package.create({
    data: {
      tenantName: input.tenantName,
      name: input.name.trim(),
      category: input.category ?? null,
      source: input.source,
      sourceId: input.sourceId.trim(),
      os: input.os,
      scope: input.scope ?? "machine",
      rebootPolicy: input.rebootPolicy ?? "defer-if-user-active",
      silentInstallArgs: input.silentInstallArgs ?? null,
      silentUninstallArgs: input.silentUninstallArgs ?? null,
      detectionRuleJson: input.detectionRule ? JSON.stringify(input.detectionRule) : null,
      isApproved: false,
      versions: input.initialVersion
        ? {
            create: {
              version: input.initialVersion.version,
              artifactUrl: input.initialVersion.artifactUrl ?? null,
              artifactSha256: input.initialVersion.artifactSha256 ?? null,
              isApprovedDefault: true,
            },
          }
        : undefined,
    },
    include: { versions: true },
  })

  await writeAudit({
    actorEmail: input.createdBy,
    clientName: input.tenantName,
    action: "software.package.create",
    outcome: "ok",
    detail: { packageId: pkg.id, name: pkg.name, source: pkg.source, os: pkg.os },
  })
  return pkg
}

export async function approvePackage(packageId: string, by: string) {
  const pkg = await prisma.fl_Package.update({
    where: { id: packageId },
    data: { isApproved: true },
  })
  await writeAudit({
    actorEmail: by,
    clientName: pkg.tenantName,
    action: "software.package.approve",
    outcome: "ok",
    detail: { packageId: pkg.id, name: pkg.name },
  })
  return pkg
}

export async function archivePackage(packageId: string, by: string) {
  const pkg = await prisma.fl_Package.update({
    where: { id: packageId },
    data: { archivedAt: new Date() },
  })
  await writeAudit({
    actorEmail: by,
    clientName: pkg.tenantName,
    action: "software.package.archive",
    outcome: "ok",
    detail: { packageId: pkg.id, name: pkg.name },
  })
  return pkg
}

/**
 * Stub for Phase 3 step 5 — parse an uploaded MSI to suggest detection
 * rule + silent install args. Real implementation needs `msiinfo` from
 * msitools in the container; for v1 we return mocked-but-shaped output
 * so the upload UI flow is testable.
 */
export interface ParsedArtifact {
  vendorMetadata: Record<string, string>
  silentInstallArgs: string
  silentUninstallArgs?: string
  suggestedDetectionRule: PackageDetectionRule
  suggestedVersion: string
}

export function mockParseArtifact(filename: string): ParsedArtifact {
  // The upload flow uses this until msiinfo is in the container.
  // The shape matches what the real parse will return — call sites
  // don't change when we swap the implementation.
  const lower = filename.toLowerCase()
  const productCode = "{" + cuidLikeUuid() + "}"
  if (lower.endsWith(".msi")) {
    return {
      vendorMetadata: {
        productCode,
        upgradeCode: "{" + cuidLikeUuid() + "}",
        productVersion: "0.0.0",
      },
      silentInstallArgs: "/quiet /norestart",
      silentUninstallArgs: "/quiet /norestart",
      suggestedDetectionRule: { kind: "msi-product-code", productCode },
      suggestedVersion: "0.0.0",
    }
  }
  if (lower.endsWith(".pkg")) {
    return {
      vendorMetadata: { bundleId: "com.unknown.app" },
      silentInstallArgs: "-pkg <file> -target /",
      suggestedDetectionRule: { kind: "registry-uninstall-key", displayName: filename },
      suggestedVersion: "0.0.0",
    }
  }
  // generic / .exe / .deb fallback
  return {
    vendorMetadata: {},
    silentInstallArgs: "/silent",
    suggestedDetectionRule: { kind: "registry-uninstall-key", displayName: filename },
    suggestedVersion: "0.0.0",
  }
}

function cuidLikeUuid(): string {
  // Cheap pseudo-uuid for the mock parse output — purely cosmetic.
  const hex = "0123456789abcdef"
  const seg = (n: number) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join("")
  return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`
}
