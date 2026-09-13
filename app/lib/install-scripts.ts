// Deploy-on-the-fly (2026-09-13) — the two scripts served under
// /install/k/<key>/. Both have the FleetHub URL and the client's
// enrollment key baked in, so the operator's whole job is one line:
//
//   iwr -useb https://fleethub.pcc2k.com/install/k/<key>/pcc2k-agent.ps1 | iex
//   curl -fsSL https://fleethub.pcc2k.com/install/k/<key>/pcc2k-agent.sh | sudo bash
//
// Windows: the script only downloads + checksum-verifies the binary and
// then hands off to `pcc2k-agent.exe setup --key … --url …` (Go) — the
// same code path the double-click installer uses, so there is exactly
// one Windows install routine to keep correct. Linux/macOS: the script
// does the whole job itself (enroll, env file, systemd unit) because
// that path already existed and works.

const PS1 = String.raw

export function renderKeyBootstrapPs1(fleethubUrl: string, key: string): string {
  const url = fleethubUrl.replace(/\/$/, "")
  return PS1`# pcc2k-agent — install + enroll (FleetHub deploy link)
# One line, from any PowerShell (self-elevates):
#   iwr -useb ${url}/install/k/${key}/pcc2k-agent.ps1 | iex

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$FleetHubUrl = "${url}"
$EnrollKey   = "${key}"

# Self-elevate: re-run this exact one-liner in an elevated PowerShell and
# wait for it, so a tech can paste it into a normal prompt.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "==> requesting elevation (UAC)"
  $cmd = "iwr -useb $FleetHubUrl/install/k/$EnrollKey/pcc2k-agent.ps1 | iex"
  $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-Command",$cmd)
  if ($p.ExitCode -ne 0) { throw "elevated install failed (exit $($p.ExitCode))" }
  return
}

$installDir = "C:\Program Files\pcc2k-agent"
$binPath    = "$installDir\pcc2k-agent.exe"
$tmp        = Join-Path $env:TEMP "pcc2k-agent-$EnrollKey.exe"

Write-Host "==> downloading pcc2k-agent (windows-amd64)"
Invoke-WebRequest -UseBasicParsing -Uri "$FleetHubUrl/install/pcc2k-agent-windows-amd64.exe" -OutFile $tmp

# Verify sha256 against the published manifest before running anything.
Write-Host "==> verifying checksum"
$manifest = Invoke-RestMethod -UseBasicParsing -Uri "$FleetHubUrl/install/agent-manifest.json"
$expected = $manifest.platforms.'windows-amd64'.sha256
if (-not $expected) { Remove-Item -Force $tmp; throw "no published sha256 for windows-amd64 — refusing to install" }
$actual = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
if ($actual -ne $expected.ToLower()) { Remove-Item -Force $tmp; throw "checksum mismatch! expected $expected got $actual — refusing to install" }
Write-Host "    sha256 verified"

# Hand off to the agent's own setup routine (copies itself into Program
# Files, enrolls with the key, registers + starts the service; replaces
# an existing install cleanly).
Write-Host "==> running setup"
& $tmp setup --key $EnrollKey --url $FleetHubUrl --no-pause
$code = $LASTEXITCODE
Remove-Item -Force $tmp -ErrorAction SilentlyContinue
if ($code -ne 0) { throw "pcc2k-agent setup failed (exit $code)" }
Write-Host "==> done — the machine will appear in FleetHub within a minute."
`
}

export function renderKeyBootstrapSh(fleethubUrl: string, key: string): string {
  const url = fleethubUrl.replace(/\/$/, "")
  return `#!/usr/bin/env bash
# pcc2k-agent — install + enroll (FleetHub deploy link)
#   curl -fsSL ${url}/install/k/${key}/pcc2k-agent.sh | sudo bash
set -euo pipefail

FLEETHUB_URL="${url}"
ENROLL_KEY="${key}"
BIN_PATH="/usr/local/bin/pcc2k-agent"
SECRET_PATH="\${PCC2K_SECRET_PATH:-/etc/pcc2k-agent.env}"

if [ "$(id -u)" -ne 0 ]; then echo "run as root (sudo)" >&2; exit 1; fi

ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS-$ARCH" in
  linux-x86_64)  PLATFORM="linux-amd64" ;;
  darwin-x86_64) PLATFORM="darwin-amd64" ;;
  darwin-arm64)  PLATFORM="darwin-amd64" ;; # Rosetta; native arm64 build not staged yet
  *) echo "unsupported platform $OS-$ARCH" >&2; exit 2 ;;
esac

echo "==> downloading pcc2k-agent ($PLATFORM)"
TMP=$(mktemp)
curl -fsSL "$FLEETHUB_URL/install/pcc2k-agent-$PLATFORM" -o "$TMP"

echo "==> verifying checksum"
EXPECTED=$(curl -fsSL "$FLEETHUB_URL/install/agent-manifest.json" | sed -n 's/.*"'"$PLATFORM"'"[^}]*"sha256": *"\\([0-9a-f]*\\)".*/\\1/p' | head -1)
if [ -z "$EXPECTED" ]; then rm -f "$TMP"; echo "no published sha256 for $PLATFORM — refusing to install" >&2; exit 3; fi
if command -v sha256sum >/dev/null; then ACTUAL=$(sha256sum "$TMP" | cut -d' ' -f1); else ACTUAL=$(shasum -a 256 "$TMP" | cut -d' ' -f1); fi
if [ "$ACTUAL" != "$EXPECTED" ]; then rm -f "$TMP"; echo "checksum mismatch! expected $EXPECTED got $ACTUAL" >&2; exit 3; fi
echo "    sha256 verified"

if [ "$OS" = "linux" ] && systemctl is-active --quiet pcc2k-agent 2>/dev/null; then systemctl stop pcc2k-agent; fi
install -m 0755 "$TMP" "$BIN_PATH"; rm -f "$TMP"

echo "==> enrolling with FleetHub"
ENROLL_RESPONSE=$(curl -fsS -X POST "$FLEETHUB_URL/api/agent-ingest/enroll" \\
  -H "Content-Type: application/json" \\
  -d "{\\"token\\": \\"$ENROLL_KEY\\", \\"hostname\\": \\"$(hostname)\\", \\"os\\": \\"$OS\\", \\"osVersion\\": \\"$(uname -r)\\"}")
json() { printf '%s' "$ENROLL_RESPONSE" | sed -n 's/.*"'"$1"'": *"\\([^"]*\\)".*/\\1/p' | head -1; }
AGENT_ID=$(json agentId); AGENT_SECRET=$(json agentSecret); GATEWAY_URL=$(json gatewayUrl); TENANT_NAME=$(json tenantName)
if [ -z "$AGENT_ID" ] || [ -z "$AGENT_SECRET" ] || [ -z "$GATEWAY_URL" ]; then
  echo "enrollment failed: $ENROLL_RESPONSE" >&2; exit 4
fi

umask 077
cat > "$SECRET_PATH" <<EOF
PCC2K_AGENT_ID=$AGENT_ID
PCC2K_AGENT_TOKEN=$AGENT_SECRET
PCC2K_FLEETHUB_AGENT_SECRET=$AGENT_SECRET
PCC2K_FLEETHUB_URL=$FLEETHUB_URL
PCC2K_GATEWAY_URL=$GATEWAY_URL
PCC2K_CLIENT_NAME=$TENANT_NAME
EOF
chmod 0600 "$SECRET_PATH"

if [ "$OS" = "linux" ]; then
  echo "==> installing systemd unit"
  cat > /etc/systemd/system/pcc2k-agent.service <<EOF
[Unit]
Description=pcc2k-agent (FleetHub managed)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$SECRET_PATH
ExecStart=$BIN_PATH
Restart=on-failure
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now pcc2k-agent
else
  echo "==> installing launchd job"
  PLIST=/Library/LaunchDaemons/com.pcc2k.agent.plist
  ENV_XML=$(sed -n 's/^\\([A-Z_0-9]*\\)=\\(.*\\)$/    <key>\\1<\\/key><string>\\2<\\/string>/p' "$SECRET_PATH")
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.pcc2k.agent</string>
  <key>ProgramArguments</key><array><string>$BIN_PATH</string></array>
  <key>EnvironmentVariables</key><dict>
$ENV_XML
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
EOF
  launchctl bootout system "$PLIST" 2>/dev/null || true
  launchctl bootstrap system "$PLIST"
fi

echo "==> pcc2k-agent enrolled as $AGENT_ID ($TENANT_NAME) and started."
`
}
