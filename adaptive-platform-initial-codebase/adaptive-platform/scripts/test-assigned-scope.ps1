#Requires -Version 7.0
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://localhost:4000',
  [string]$Origin = 'http://localhost:3000',
  [string]$Password = 'password123'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$headers = @{ Origin = $Origin; 'X-Organization-Id' = 'cf463143-ab36-4fad-820b-bca37723a1ef' }
$session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$base = $BaseUrl.TrimEnd('/')
$assigned = 'f1500000-0000-4000-8000-000000000004'
$unassigned = 'f1500000-0000-4000-8000-000000000005'
$loggedIn = $false
$previousProbeSession = $env:ADAPTIVE_PROBE_SESSION
try {
  Invoke-RestMethod "$base/v1/auth/login" -Method Post -Headers $headers -WebSession $session `
    -ContentType 'application/json' -Body (@{email='teacher2@test.com';password=$Password} | ConvertTo-Json) | Out-Null
  $loggedIn = $true
  $grant = Invoke-RestMethod "$base/v1/org/permissions/check?permission=student.read" -Headers $headers -WebSession $session
  if (-not $grant.granted -or @($grant.scopes).Count -ne 1 -or $grant.scopes[0] -ne 'assigned_entity') {
    throw "Expected exactly assigned_entity: $($grant | ConvertTo-Json -Compress)"
  }
  $reply = Invoke-RestMethod "$base/v1/ai/chat" -Method Post -Headers $headers -WebSession $session `
    -ContentType 'application/json' -Body '{"message":"Show my assigned students."}' -TimeoutSec 180
  $sources = @($reply.sourcesUsed)
  if ($sources.Count -ne 1 -or $sources[0].entityType -ne 'student' -or $sources[0].entityId -ne $assigned) {
    throw "Expected only the assigned student in sourcesUsed: $($sources | ConvertTo-Json -Depth 5 -Compress)"
  }
  if ($reply.reply -notmatch 'Scope Assigned Student' -or $reply.reply -match "Scope Unassigned Student|$unassigned") {
    throw 'Reply omitted assigned student or disclosed unassigned student.'
  }
  Write-Host 'PASS: HTTP permissions and chat sources prove assigned-only access.'
  # No direct-fetch HTTP route exists. Probe the exact production tool executor
  # using this login session and a privileged DB connection, keeping authorization active.
  $env:ADAPTIVE_PROBE_SESSION = $session.Cookies.GetCookies([uri]$base)['ruhuka_session'].Value
  Push-Location (Join-Path $PSScriptRoot '../apps/api')
  try {
    pnpm exec tsx --env-file=../../.env scripts/probe-assigned-scope.ts
    if ($LASTEXITCODE -ne 0) { throw 'Direct-ID tool probe failed.' }
  } finally { Pop-Location }
  Write-Host 'PASS: all assigned_entity checks passed.'
} finally {
  $env:ADAPTIVE_PROBE_SESSION = $previousProbeSession
  if ($loggedIn) {
    Invoke-RestMethod "$base/v1/auth/logout" -Method Post -Headers $headers -WebSession $session `
      -ContentType 'application/json' -Body '{}' | Out-Null
  }
}
