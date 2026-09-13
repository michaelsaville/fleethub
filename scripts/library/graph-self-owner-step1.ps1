# Graph: make the PCC2K SSO app own itself — STEP 1 of 2 (get sign-in code)
#
# Runs as SYSTEM under the FleetHub agent, so no browser can open here.
# Instead this starts a Microsoft "device code" sign-in (the same flow the
# Microsoft Graph PowerShell module uses) and prints the code. Michael then
# opens the URL on any device, enters the code, signs in as the PCC2K admin
# and consents to Application.ReadWrite.All (tick "consent on behalf of your
# organization"). Then run STEP 2 within 15 minutes.
#
# Nothing is written anywhere except the device_code (not a credential by
# itself) under the agent's ProgramData folder, which step 2 consumes.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$tenant   = "13872730-42a1-4163-8874-e90384e1bc15"
$clientId = "14d82eec-204b-4c2f-b7e8-296a70dab67e"   # Microsoft Graph PowerShell (public client, first-party)
$scope    = "https://graph.microsoft.com/Application.ReadWrite.All openid"

$r = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenant/oauth2/v2.0/devicecode" `
       -Body @{ client_id = $clientId; scope = $scope }

$dir = "C:\ProgramData\pcc2k-agent"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
@{ device_code = $r.device_code; client_id = $clientId; tenant = $tenant; issued = (Get-Date).ToString("o"); expires_in = $r.expires_in } |
  ConvertTo-Json | Set-Content -Path "$dir\graph-devicecode.json" -Encoding UTF8

Write-Output "=================================================================="
Write-Output "  1. Open:   $($r.verification_uri)"
Write-Output "  2. Code:   $($r.user_code)"
Write-Output "  3. Sign in as msaville@pcc2k.com, tick 'Consent on behalf of your organization', Accept."
Write-Output "  4. Run STEP 2 within $([int]($r.expires_in/60)) minutes."
Write-Output "=================================================================="
