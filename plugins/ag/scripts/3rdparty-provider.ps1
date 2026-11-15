<#
    3rdparty-provider.ps1 - pick the provider the third-party builders run on, or show it.

    The builders of goal-prompt-3rdparty run through ext-build.ps1 on Fireworks or OpenRouter.
    The choice is "provider" in ~/.claude/ext-build.json (the file is created when missing).
    A legacy flat file (baseUrl, keyFile, defaultModel, modelPrefix at the top) is moved into
    "providers": { "<its provider, default fireworks>": { ... } } first; other keys are kept.
    ext-build.ps1 reads the file on every run, so the change applies to the next build.

    Usage
        3rdparty-provider.ps1 [fireworks|openrouter|status] [-ConfigPath <file>]
    Empty means status. Status prints the provider, its default model, the config file and
    whether a key is set (never the key), with the command that sets a missing key.

    Exit 0 ok, 2 bad argument, invalid JSON or a config ext-build.ps1 cannot use.
    Windows PowerShell 5.1 and PowerShell 7 compatible.
#>
param(
    [Parameter(Position = 0)][string]$Mode = 'status',
    [string]$ConfigPath = ''
)

$ErrorActionPreference = 'Stop'

# Dot-sourcing only defines the functions (Read-ExtConfig, Test-ProviderKey, ...).
. (Join-Path $PSScriptRoot 'ext-build.ps1')

$choices = @('fireworks', 'openrouter')
$flatKeys = @('baseUrl', 'keyFile', 'defaultModel', 'modelPrefix')

$Mode = ([string]$Mode).Trim().ToLowerInvariant()
if (-not $Mode) { $Mode = 'status' }
if (@($choices + 'status') -notcontains $Mode) {
    Write-Host ('error: use fireworks, openrouter or status (got "' + $Mode + '").')
    exit 2
}

if (-not $ConfigPath) { $ConfigPath = Join-Path (Join-Path (Get-KeyHome) '.claude') 'ext-build.json' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)

function Read-UserConfig([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $text = [IO.File]::ReadAllText($Path)
    $obj = $null
    if ($text.Trim()) {
        try { $obj = $text | ConvertFrom-Json } catch { $obj = $null }
    }
    if ($null -eq $obj -or $obj -is [array] -or $obj -isnot [psobject]) {
        Write-Host ('error: ' + $Path + ' is not a valid JSON object; fix it first, nothing was changed.')
        exit 2
    }
    return $obj
}

function Save-UserConfig([string]$Path, $Obj) {
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $json = $Obj | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

# The file with "provider" set to $Name and flat provider keys moved under "providers".
# Returns $null when nothing would change.
function Get-UpdatedConfig($Obj, [string]$Name) {
    $names = @($Obj.PSObject.Properties | ForEach-Object { $_.Name })
    $flat = @($flatKeys | Where-Object { $names -contains $_ })
    $cur = ([string](Get-ExtProp $Obj 'provider' '')).Trim().ToLowerInvariant()
    if ($flat.Count -eq 0 -and $cur -eq $Name) { return $null }

    $provs = [ordered]@{}
    $old = Get-ExtProp $Obj 'providers'
    if ($null -ne $old) {
        foreach ($pp in $old.PSObject.Properties) { $provs[$pp.Name] = $pp.Value }
    }
    if ($flat.Count -gt 0) {
        $owner = if ($cur) { $cur } else { 'fireworks' }
        $entry = [ordered]@{}
        foreach ($k in $flat) { $entry[$k] = $Obj.$k }
        # An existing providers entry wins over the flat keys, as in ext-build.ps1.
        if ($provs.Contains($owner) -and $provs[$owner] -is [psobject]) {
            foreach ($pp in $provs[$owner].PSObject.Properties) { $entry[$pp.Name] = $pp.Value }
        }
        $provs[$owner] = [pscustomobject]$entry
    }

    $out = [ordered]@{ provider = $Name }
    if ($provs.Count -gt 0) { $out['providers'] = [pscustomobject]$provs }
    foreach ($p in $Obj.PSObject.Properties) {
        if (@('provider', 'providers') -contains $p.Name -or $flatKeys -contains $p.Name) { continue }
        $out[$p.Name] = $p.Value
    }
    return [pscustomobject]$out
}

function Write-Status([string]$Path) {
    # A missing user file: the plugin default alone (passed as the config, so no other file is read).
    $exists = Test-Path -LiteralPath $Path -PathType Leaf
    $read = if ($exists) { $Path } else { Join-Path (Split-Path -Parent $PSScriptRoot) 'ext-build.default.json' }
    $cfg = $null
    try { $cfg = Read-ExtConfig $read '' }
    catch {
        if ($_.Exception.Data['ExtSetup']) { Write-Host ('error: ' + $_.Exception.Message); exit 2 }
        throw
    }
    Write-Host ('provider: ' + $cfg.Provider + ' (' + $cfg.ProviderLabel + ')')
    Write-Host ('default model: ' + (Resolve-ExtModel '' $cfg) + ' (another one: model=<id> in the goal)')
    if ($exists) { Write-Host ('config: ' + $Path) }
    else { Write-Host ('config: ' + $Path + ' (not there yet; the plugin default applies)') }
    $set = $false
    try { $set = Test-ProviderKey -Provider $cfg.Provider -KeyFile $cfg.KeyFile } catch { $set = $false }
    if ($set) { Write-Host ('key: set for ' + $cfg.Provider) }
    else {
        Write-Host ('key: not set for ' + $cfg.Provider + '; set it in your own terminal (never in the chat):')
        Write-Host ('  powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.claude\ag\ag-key.ps1 set ' + $cfg.Provider)
    }
}

$obj = Read-UserConfig $ConfigPath

if ($Mode -ne 'status') {
    if ($null -eq $obj) {
        Save-UserConfig $ConfigPath ([pscustomobject][ordered]@{ provider = $Mode })
        Write-Host ('done: builders run on ' + $Mode + ' (created ' + $ConfigPath + ')')
    }
    else {
        $new = Get-UpdatedConfig $obj $Mode
        if ($null -eq $new) { Write-Host ('skip: builders already run on ' + $Mode + ' (' + $ConfigPath + ')') }
        else {
            Save-UserConfig $ConfigPath $new
            Write-Host ('done: builders run on ' + $Mode + ' (' + $ConfigPath + ')')
        }
    }
}

Write-Status $ConfigPath
exit 0
