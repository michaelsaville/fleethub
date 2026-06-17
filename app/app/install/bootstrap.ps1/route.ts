import { NextResponse } from "next/server"

// Phase 13 WS-D.0 — Windows bootstrap one-liner.
//
// Operator runs (Admin PowerShell):
//   $env:PCC2K_BOOTSTRAP_TOKEN = "..."
//   $env:PCC2K_FLEETHUB_URL = "..."
//   iwr -useb https://fleethub.pcc2k.com/install/bootstrap.ps1 | iex

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SCRIPT = `# pcc2k-agent Windows bootstrap.
# Required env: PCC2K_BOOTSTRAP_TOKEN, PCC2K_FLEETHUB_URL
#
# Critical: $ErrorActionPreference = "Stop" makes every cmdlet fatal
# on failure. Without this, a 404 on the binary download would let
# the script continue and burn the enrollment token on a half-install.

$ErrorActionPreference = "Stop"

if (-not $env:PCC2K_BOOTSTRAP_TOKEN) { throw "PCC2K_BOOTSTRAP_TOKEN env var required" }
if (-not $env:PCC2K_FLEETHUB_URL)    { throw "PCC2K_FLEETHUB_URL env var required" }

$installDir = "C:\\Program Files\\pcc2k-agent"
$binPath    = "$installDir\\pcc2k-agent.exe"

New-Item -ItemType Directory -Path $installDir -Force | Out-Null

Write-Host "==> downloading pcc2k-agent (windows-amd64)"
$tmp = "$installDir\\pcc2k-agent.new.exe"
Invoke-WebRequest -UseBasicParsing -Uri "$env:PCC2K_FLEETHUB_URL/install/pcc2k-agent-windows-amd64.exe" -OutFile $tmp

# SEC-7 — verify sha256 against the published manifest before install.
# Fail closed so a MITM'd / compromised /install can't become SYSTEM
# RCE on every endpoint. (Authenticode signature check is a follow-up
# gated on the EV cert; sha256 closes the MITM hole today.)
Write-Host "==> verifying checksum"
$manifest = Invoke-RestMethod -UseBasicParsing -Uri "$env:PCC2K_FLEETHUB_URL/install/agent-manifest.json"
$expected = $manifest.platforms.'windows-amd64'.sha256
if (-not $expected) { Remove-Item -Force $tmp; throw "no published sha256 for windows-amd64 in manifest — refusing to install" }
$actual = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
if ($actual -ne $expected.ToLower()) {
  Remove-Item -Force $tmp
  throw "checksum mismatch for windows-amd64! expected $expected got $actual — refusing to install"
}
Write-Host "    sha256 verified ($actual)"

if (Test-Path $binPath) {
  Stop-Service -Name pcc2k-agent -Force -ErrorAction SilentlyContinue
  Get-Service -Name pcc2k-agent -ErrorAction SilentlyContinue | Out-Null
}
Move-Item -Force $tmp $binPath

Write-Host "==> enrolling with FleetHub"
$body = @{
  token     = $env:PCC2K_BOOTSTRAP_TOKEN
  hostname  = [System.Net.Dns]::GetHostName()
  os        = "windows"
  osVersion = [System.Environment]::OSVersion.VersionString
} | ConvertTo-Json -Compress

$enrollResponse = Invoke-RestMethod -Method Post \`
  -Uri "$env:PCC2K_FLEETHUB_URL/api/agent-ingest/enroll" \`
  -ContentType "application/json" \`
  -Body $body

$agentId     = $enrollResponse.agentId
$agentSecret = $enrollResponse.agentSecret
$gatewayUrl  = $enrollResponse.gatewayUrl
$tenantName  = $enrollResponse.tenantName
if (-not $agentId -or -not $agentSecret -or -not $gatewayUrl) {
  throw "enrollment failed: $($enrollResponse | ConvertTo-Json)"
}

# The agent's install subcommand writes its own DPAPI-encrypted
# config under %ProgramData%\\PCC2K, registers the SCM service with
# LocalSystem, and sets restart-on-failure policy. No env-file
# needed on Windows — service mode reads the persisted config.
Write-Host "==> installing service"
$installArgs = @(
  "install",
  "--gateway",  $gatewayUrl,
  "--token",    $agentSecret,
  "--agent-id", $agentId,
  "--client",   $tenantName,
  "--role",     "workstation"
)
& $binPath @installArgs
& $binPath start

Write-Host "==> pcc2k-agent enrolled as $agentId and started."
Write-Host "    gateway: $gatewayUrl"
Write-Host "    tenant : $tenantName"
`

export function GET() {
  return new NextResponse(SCRIPT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
