#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:4000',
    [string]$Origin = 'http://localhost:3000',
    [guid]$OrganizationId = 'cf463143-ab36-4fad-820b-bca37723a1ef',
    [guid]$OtherOrganizationId = 'b1d3a3e2-2cd3-4fb5-a223-5d8269596363',
    [string]$Email = 'teacher@test.com',
    [string]$Password = $(if ($env:ADAPTIVE_TEST_PASSWORD) { $env:ADAPTIVE_TEST_PASSWORD } else { 'password123' }),
    [switch]$AllowExisting,
    [switch]$AuthOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility
$apiBase = $BaseUrl.TrimEnd('/')
$webSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$loggedIn = $false
$failed = $false

function Invoke-Api {
    param(
        [Parameter(Mandatory)][ValidateSet('GET', 'POST')][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [object]$Body,
        [int]$ExpectedStatus = 200,
        [guid]$Tenant = $OrganizationId,
        [switch]$PermitConflict
    )
    $parameters = @{
        Uri = "$apiBase$Path"
        Method = $Method
        Headers = @{ Origin = $Origin; 'X-Organization-Id' = $Tenant.ToString() }
        WebSession = $webSession
        ContentType = 'application/json'
        SkipHttpErrorCheck = $true
        StatusCodeVariable = 'httpStatus'
        TimeoutSec = 30
    }
    if ($null -ne $Body) {
        $parameters.Body = ConvertTo-Json -InputObject $Body -Depth 20 -Compress
    }
    $httpStatus = 0
    try {
        $result = Invoke-RestMethod @parameters
    } catch {
        # Do not print request bodies: the login body contains a password.
        throw "$Method $Path could not complete: $($_.Exception.Message)"
    }
    if ($httpStatus -eq 409 -and $PermitConflict -and $AllowExisting) {
        if ($result.error -ne 'already_exists') { throw "Unexpected conflict from $Path." }
        Write-Host "EXISTS $Method $Path (409); creation skipped by -AllowExisting." -ForegroundColor Yellow
        return $null
    }
    if ($httpStatus -ne $ExpectedStatus) {
        $detail = ConvertTo-Json -InputObject $result -Depth 5 -Compress
        $hint = if ($httpStatus -eq 409) { ' Use -AllowExisting to tolerate definitions from an earlier run.' } else { '' }
        throw "$Method $Path returned HTTP $httpStatus; expected $ExpectedStatus. Response: $detail$hint"
    }
    Write-Host "PASS $Method $Path ($httpStatus)" -ForegroundColor Green
    return $result
}

function Assert-CreatedResource {
    param([object]$Resource, [string]$KeyField, [string]$ExpectedKey)
    if ($null -eq $Resource) { return } # Explicitly accepted duplicate; never claim a new resource.
    if (-not $Resource.id -or $Resource.organization_id -ne $OrganizationId.ToString()) {
        throw 'Created resource has no ID or belongs to the wrong organization.'
    }
    if ($KeyField -and $Resource.$KeyField -ne $ExpectedKey) {
        throw "Created resource has an unexpected $KeyField."
    }
}

try {
    if ($OrganizationId -eq $OtherOrganizationId) {
        throw 'OtherOrganizationId must differ from OrganizationId.'
    }
    Write-Host "Testing Adaptive API: $apiBase" -ForegroundColor Cyan
    Write-Host "Organization: $OrganizationId" -ForegroundColor Cyan

    # 1. Login; WebSession retains the HttpOnly session cookie.
    $null = Invoke-Api POST '/v1/auth/login' -Body @{ email = $Email; password = $Password }
    $loggedIn = $true

    # 2. Load the profile using the organization selector.
    $profile = Invoke-Api GET '/v1/users/me'
    if (-not $profile.userId -or $profile.email -ne $Email) {
        throw 'The returned profile does not match the authenticated test user.'
    }

    if (-not $AuthOnly) {
        # 3. Create a patient entity definition.
        $entity = Invoke-Api POST '/v1/org/entity-types' -ExpectedStatus 201 -PermitConflict -Body @{
            key = 'patient'
            displayName = 'Patient'
            schema = @{
                type = 'object'
                properties = @{ name = @{ type = 'string' }; date_of_birth = @{ type = 'string' } }
            }
        }
        Assert-CreatedResource $entity 'type_key' 'patient'

        # 4. Create the doctor role. The API adds user.read/own_user automatically.
        $role = Invoke-Api POST '/v1/org/roles' -ExpectedStatus 201 -PermitConflict -Body @{
            key = 'doctor'; displayName = 'Doctor'
        }
        Assert-CreatedResource $role 'role_key' 'doctor'

        # 5. Define the organization-owned permission.
        $permission = Invoke-Api POST '/v1/org/permissions' -ExpectedStatus 201 -PermitConflict -Body @{
            key = 'patient.read'; description = 'Read assigned patients'
        }
        Assert-CreatedResource $permission 'permission_key' 'patient.read'

        # 6. Grant it to doctor. Migration 013 provisions the assigned_to relationship type.
        $grant = Invoke-Api POST '/v1/org/role-permissions' -ExpectedStatus 201 -PermitConflict -Body @{
            roleKey = 'doctor'; permissionKey = 'patient.read'; scope = 'assigned_entity'
        }
        Assert-CreatedResource $grant
        if ($null -ne $grant) {
            if ($grant.scope -ne 'assigned_entity') { throw 'Unexpected grant scope.' }
            if ($null -ne $role -and $grant.role_id -ne $role.id) { throw 'Grant refers to the wrong role.' }
            if ($null -ne $permission -and $grant.permission_id -ne $permission.id) { throw 'Grant refers to the wrong permission.' }
        }

        # 7. The same cookie must not authorize a different tenant.
        # Supply an existing inaccessible organization to test two real tenants.
        Write-Host "Checking unauthorized organization: $OtherOrganizationId" -ForegroundColor Cyan
        $deniedProfile = Invoke-Api GET '/v1/users/me' -Tenant $OtherOrganizationId -ExpectedStatus 403
        if ($deniedProfile.error -ne 'forbidden') { throw 'Expected profile access to be forbidden.' }
        $deniedWrite = Invoke-Api POST '/v1/org/roles' -Tenant $OtherOrganizationId -ExpectedStatus 403 -Body @{
            key = 'isolation_probe'; displayName = 'Must not be created'
        }
        if ($deniedWrite.error -ne 'forbidden') { throw 'Expected cross-organization write to be forbidden.' }
        $deniedPermission = Invoke-Api GET '/v1/org/permissions/check?permission=patient.read' -Tenant $OtherOrganizationId
        if ($deniedPermission.granted -ne $false) { throw 'Permission leaked across organizations.' }

        # Confirm the original tenant still works after the denial checks.
        $null = Invoke-Api GET '/v1/users/me'
        Write-Host 'Patient, doctor, and patient.read definitions remain for inspection.' -ForegroundColor Yellow
    }
} catch {
    $failed = $true
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $Password = $null
    if ($loggedIn) {
        try {
            $null = Invoke-Api POST '/v1/auth/logout' -Body @{}
        } catch {
            $failed = $true
            Write-Host "FAIL during logout: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

if ($failed) { exit 1 }
Write-Host 'All requested live checks passed.' -ForegroundColor Green
exit 0
