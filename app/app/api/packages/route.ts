import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/authz"
import { createPackage, mockParseArtifact } from "@/lib/packages"

// POST /api/packages
// Body: { tenantName, name, source, sourceId, os, scope?, category?,
//         silentInstallArgs?, detectionRule?, initialVersion?,
//         /** custom-only: filename to mock-parse */
//         parseFromFilename? }
export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as {
    tenantName?: string
    name?: string
    source?: "winget" | "choco" | "brew" | "custom"
    sourceId?: string
    os?: "windows" | "macos" | "linux" | "any"
    scope?: "machine" | "user"
    category?: string
    silentInstallArgs?: string
    silentUninstallArgs?: string
    detectionRule?: import("@/lib/packages").PackageDetectionRule
    initialVersion?: { version: string; artifactUrl?: string; artifactSha256?: string }
    parseFromFilename?: string
  }
  if (!body.tenantName || !body.name || !body.source || !body.sourceId || !body.os) {
    return NextResponse.json(
      { error: "tenantName, name, source, sourceId, os required" },
      { status: 400 },
    )
  }

  // For custom packages, optionally use mock-parse to fill in detection
  // + silent args. Real parse via msiinfo lands later (PHASE-3-DESIGN
  // §11). The shape matches; call sites don't change.
  let detectionRule = body.detectionRule
  let silentArgs = body.silentInstallArgs
  let silentUninstallArgs = body.silentUninstallArgs
  let initialVersion = body.initialVersion
  if (body.source === "custom" && body.parseFromFilename) {
    const parsed = mockParseArtifact(body.parseFromFilename)
    detectionRule = detectionRule ?? parsed.suggestedDetectionRule
    silentArgs = silentArgs ?? parsed.silentInstallArgs
    silentUninstallArgs = silentUninstallArgs ?? parsed.silentUninstallArgs
    initialVersion = initialVersion ?? { version: parsed.suggestedVersion }
  }

  try {
    const pkg = await createPackage({
      tenantName: body.tenantName,
      name: body.name,
      category: body.category ?? null,
      source: body.source,
      sourceId: body.sourceId,
      os: body.os,
      scope: body.scope,
      silentInstallArgs: silentArgs ?? null,
      silentUninstallArgs: silentUninstallArgs ?? null,
      detectionRule,
      initialVersion,
      createdBy: session.email,
    })
    return NextResponse.json(pkg, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
