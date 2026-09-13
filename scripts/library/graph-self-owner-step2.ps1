# Graph: make the PCC2K SSO app own itself — STEP 2 of 2 (finish)
#
# Redeems the device code from step 1 for a delegated token (Michael's own
# admin rights, Application.ReadWrite.All), then adds the SSO app's service
# principal as an owner of BOTH its app registration and its enterprise app,
# so the app's own Application.ReadWrite.OwnedBy permission lets FleetHub /
# Claude manage its redirect URIs from then on. Finally adds the Immich
# mobile redirect URI (the portal rejects the app.immich:/// form) and prints
# the resulting owner + redirect lists. The token is used once and discarded.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$path = "C:\ProgramData\pcc2k-agent\graph-devicecode.json"
if (-not (Test-Path $path)) { throw "No device code on file — run STEP 1 first." }
$dc = Get-Content $path -Raw | ConvertFrom-Json

$appObjectId = "e2c892e8-22a2-4984-be7b-34bb0f49e9cc"   # DocHub / PCC2K SSO app registration (object id)
$spObjectId  = "b0265353-def8-4cab-9b0d-d0672cadb7bf"   # its service principal (enterprise app)

# --- redeem the device code (poll until Michael has approved) ---
$token = $null
for ($i = 0; $i -lt 60 -and -not $token; $i++) {
  try {
    $t = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$($dc.tenant)/oauth2/v2.0/token" `
           -Body @{ grant_type = "urn:ietf:params:oauth:grant-type:device_code"; client_id = $dc.client_id; device_code = $dc.device_code }
    $token = $t.access_token
  } catch {
    $body = $_.ErrorDetails.Message
    if ($body -match '"authorization_pending"') { Start-Sleep -Seconds 5; continue }
    if ($body -match '"expired_token"')          { throw "Device code expired — run STEP 1 again." }
    if ($body -match '"authorization_declined"') { throw "Sign-in was declined." }
    throw "Token request failed: $body"
  }
}
if (-not $token) { throw "Timed out waiting for the sign-in — run STEP 1 again and approve faster." }
Remove-Item $path -Force -ErrorAction SilentlyContinue
$h = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
$ref = @{ "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/$spObjectId" } | ConvertTo-Json -Compress

function Add-Owner($url) {
  try { Invoke-RestMethod -Method Post -Uri $url -Headers $h -Body $ref | Out-Null; Write-Output "OK   $url" }
  catch {
    if ($_.ErrorDetails.Message -match 'already exist') { Write-Output "OK   (already an owner) $url" }
    else { Write-Output "FAIL $url :: $($_.ErrorDetails.Message)" }
  }
}
Add-Owner "https://graph.microsoft.com/v1.0/applications/$appObjectId/owners/`$ref"
Add-Owner "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId/owners/`$ref"

# --- Immich mobile redirect URI (custom scheme; portal UI refuses it) ---
$app = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/applications/$appObjectId`?`$select=publicClient" -Headers $h
$uris = @($app.publicClient.redirectUris)
if ($uris -notcontains "app.immich:///oauth-callback") { $uris += "app.immich:///oauth-callback" }
Invoke-RestMethod -Method Patch -Uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" -Headers $h `
  -Body (@{ publicClient = @{ redirectUris = $uris } } | ConvertTo-Json -Depth 4) | Out-Null
Write-Output "OK   publicClient redirect URIs: $($uris -join ', ')"

# --- report ---
$owners = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/applications/$appObjectId/owners" -Headers $h
Write-Output "App owners now: $(($owners.value | ForEach-Object { if ($_.userPrincipalName) { $_.userPrincipalName } else { "$($_.displayName) [$($_.'@odata.type')]" } }) -join '; ')"
Write-Output "DONE"
