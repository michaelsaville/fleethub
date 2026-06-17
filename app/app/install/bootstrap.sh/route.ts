import { NextResponse } from "next/server"

// Phase 13 WS-D.0 — serves the Unix bootstrap one-liner.
//
// Operator pastes:
//   curl -fsSL https://fleethub.pcc2k.com/install/bootstrap.sh \
//     | PCC2K_BOOTSTRAP_TOKEN=<token> PCC2K_FLEETHUB_URL=<url> sudo bash
//
// The script downloads the platform binary from
// /install/pcc2k-agent-linux-amd64, drops it at /usr/local/bin,
// drops the systemd unit, runs first-invocation enrollment, starts
// the service. Idempotent — re-running upgrades the binary AND
// re-enrolls (operator can rotate enrollment by generating a new
// token and re-running).
//
// Served as text/plain so the curl-pipe-bash flow doesn't require
// content-type negotiation. No auth; the script is operator-visible
// and contains no secrets.

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

# pcc2k-agent Unix bootstrap.
# Required env: PCC2K_BOOTSTRAP_TOKEN, PCC2K_FLEETHUB_URL
# Optional: PCC2K_INSTALL_DIR (default /usr/local/bin)
#           PCC2K_SECRET_PATH (default /var/lib/pcc2k-agent/secret)

if [ -z "\${PCC2K_BOOTSTRAP_TOKEN:-}" ]; then
  echo "PCC2K_BOOTSTRAP_TOKEN env var required" >&2
  exit 2
fi
if [ -z "\${PCC2K_FLEETHUB_URL:-}" ]; then
  echo "PCC2K_FLEETHUB_URL env var required" >&2
  exit 2
fi

INSTALL_DIR="\${PCC2K_INSTALL_DIR:-/usr/local/bin}"
SECRET_PATH="\${PCC2K_SECRET_PATH:-/var/lib/pcc2k-agent/secret}"
BIN_PATH="\$INSTALL_DIR/pcc2k-agent"

# Detect arch
ARCH=\$(uname -m)
OS=\$(uname -s | tr '[:upper:]' '[:lower:]')
case "\$OS-\$ARCH" in
  linux-x86_64)  PLATFORM="linux-amd64" ;;
  linux-aarch64) PLATFORM="linux-arm64" ;;
  darwin-x86_64) PLATFORM="darwin-amd64" ;;
  darwin-arm64)  PLATFORM="darwin-arm64" ;;
  *) echo "unsupported platform: \$OS-\$ARCH" >&2; exit 3 ;;
esac

echo "==> downloading pcc2k-agent (\$PLATFORM)"
curl -fsSL "\$PCC2K_FLEETHUB_URL/install/pcc2k-agent-\$PLATFORM" -o "\$BIN_PATH.new"
chmod 0755 "\$BIN_PATH.new"

# SEC-7 — verify the binary's sha256 against the published manifest
# BEFORE moving it into place. A curl|bash to root with no integrity
# check means a compromised/MITM'd /install is root RCE on every
# enrolling endpoint. Fail closed: any mismatch or missing hash aborts.
# (Authenticode / Ed25519 signature verification is a follow-up, gated
# on the EV signing cert — sha256 closes the MITM hole today.)
echo "==> verifying checksum"
MANIFEST=\$(curl -fsSL "\$PCC2K_FLEETHUB_URL/install/agent-manifest.json")
if ! printf '%s' "\$MANIFEST" | grep -q "\\"\$PLATFORM\\":{\\"sha256\\""; then
  echo "no published sha256 for \$PLATFORM in manifest — refusing to install" >&2
  rm -f "\$BIN_PATH.new"; exit 5
fi
EXPECTED_SHA=\$(printf '%s' "\$MANIFEST" | sed "s/.*\\"\$PLATFORM\\":{\\"sha256\\":\\"//" | cut -c1-64)
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA=\$(sha256sum "\$BIN_PATH.new" | awk '{print \$1}')
else
  ACTUAL_SHA=\$(shasum -a 256 "\$BIN_PATH.new" | awk '{print \$1}')
fi
if [ "\$EXPECTED_SHA" != "\$ACTUAL_SHA" ]; then
  echo "checksum mismatch for \$PLATFORM!" >&2
  echo "  expected: \$EXPECTED_SHA" >&2
  echo "  actual:   \$ACTUAL_SHA" >&2
  echo "refusing to install a binary that does not match the manifest." >&2
  rm -f "\$BIN_PATH.new"; exit 5
fi
echo "    sha256 verified (\$ACTUAL_SHA)"
mv "\$BIN_PATH.new" "\$BIN_PATH"

echo "==> enrolling with FleetHub"
mkdir -p "\$(dirname "\$SECRET_PATH")"
chmod 0700 "\$(dirname "\$SECRET_PATH")"

ENROLL_RESPONSE=\$(curl -fsSL -X POST \\
  -H 'content-type: application/json' \\
  -d "{\\"token\\": \\"\$PCC2K_BOOTSTRAP_TOKEN\\", \\"hostname\\": \\"\$(hostname)\\", \\"os\\": \\"\$OS\\", \\"osVersion\\": \\"\$(uname -r)\\"}" \\
  "\$PCC2K_FLEETHUB_URL/api/agent-ingest/enroll")

AGENT_ID=\$(echo "\$ENROLL_RESPONSE"     | sed -n 's/.*"agentId":"\\([^"]*\\)".*/\\1/p')
AGENT_SECRET=\$(echo "\$ENROLL_RESPONSE" | sed -n 's/.*"agentSecret":"\\([^"]*\\)".*/\\1/p')
GATEWAY_URL=\$(echo "\$ENROLL_RESPONSE"  | sed -n 's/.*"gatewayUrl":"\\([^"]*\\)".*/\\1/p')
TENANT_NAME=\$(echo "\$ENROLL_RESPONSE"  | sed -n 's/.*"tenantName":"\\([^"]*\\)".*/\\1/p')

if [ -z "\$AGENT_ID" ] || [ -z "\$AGENT_SECRET" ] || [ -z "\$GATEWAY_URL" ]; then
  echo "enrollment failed:" >&2
  echo "\$ENROLL_RESPONSE" >&2
  exit 4
fi

# Write env file the systemd unit reads. PCC2K_AGENT_TOKEN is what
# agent runConsole() expects; we name agentSecret as that. Keep
# the FLEETHUB_AGENT_SECRET alias for posture HTTP. Permissions
# 0600 root before contents lands.
umask 077
cat > "\$SECRET_PATH" <<EOF
PCC2K_AGENT_ID=\$AGENT_ID
PCC2K_AGENT_TOKEN=\$AGENT_SECRET
PCC2K_FLEETHUB_AGENT_SECRET=\$AGENT_SECRET
PCC2K_FLEETHUB_URL=\$PCC2K_FLEETHUB_URL
PCC2K_GATEWAY_URL=\$GATEWAY_URL
PCC2K_CLIENT_NAME=\$TENANT_NAME
EOF
chmod 0600 "\$SECRET_PATH"

echo "==> installing systemd unit"
cat > /etc/systemd/system/pcc2k-agent.service <<EOF
[Unit]
Description=pcc2k-agent (FleetHub managed)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=\$SECRET_PATH
ExecStart=\$BIN_PATH
Restart=on-failure
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pcc2k-agent
systemctl status pcc2k-agent --no-pager || true

echo "==> pcc2k-agent enrolled as \$AGENT_ID and started."
`

export function GET() {
  return new NextResponse(SCRIPT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
