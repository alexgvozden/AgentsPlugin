<#
    fable-planning.ps1 - turn Fable planning on or off for one project.

    Off (the default): planning in goal runs and /ag:design runs on Opus 5.5
    high, as the global rules say.
    On: the goal-prompt skills and /ag:design send their planning work to a
    subagent on Fable 5.2 high. Ordinary chats, the main thread, building, UI
    parts, reviews and failed steps are not changed.

    The setting is one key in the project's .claude/ag.json:
        { "fablePlanning": true }
    Other keys in that file are kept. "off" removes the key, and the file too
    if nothing else is left in it.

    Usage
        fable-planning.ps1 [on|off|status] [-ProjectDir <dir>]
    ProjectDir defaults to the git root of the current folder, else the folder.

    Exit 0 ok, 2 bad argument or unreadable ag.json.
    Windows PowerShell 5.1 compatible.
#>
param(
    [Parameter(Position = 0)][string]$Mode = 'status',
    [string]$ProjectDir = ''
)

$ErrorActionPreference = 'Stop'

function Get-ProjectRoot([string]$Dir) {
    if ($Dir) { return [System.IO.Path]::GetFullPath($Dir) }
    $top = $null
    try { $top = (& git rev-parse --show-toplevel 2>$null) } catch { $top = $null }
    if ($LASTEXITCODE -eq 0 -and $top) { return [System.IO.Path]::GetFullPath(($top | Select-Object -First 1)) }
    return (Get-Location).Path
}

function Test-Prop($Object, [string]$Name) {
    if ($null -eq $Object) { return $false }
    return ($Object.PSObject.Properties.Name -contains $Name)
}

function Read-AgConfig([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return [PSCustomObject]@{} }
    $text = [System.IO.File]::ReadAllText($Path)
    if (-not $text.Trim()) { return [PSCustomObject]@{} }
    try { return ($text | ConvertFrom-Json) }
    catch {
        Write-Host ('error: ' + $Path + ' is not valid JSON; fix it first, nothing was changed.')
        exit 2
    }
}

function Save-AgConfig([string]$Path, $Config) {
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $json = $Config | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

function Test-FableOn($Config) {
    return ((Test-Prop $Config 'fablePlanning') -and ($Config.fablePlanning -eq $true))
}

$Mode = $Mode.ToLowerInvariant()
if (@('on', 'off', 'status') -notcontains $Mode) {
    Write-Host ('error: use on, off or status (got "' + $Mode + '").')
    exit 2
}

$root = Get-ProjectRoot $ProjectDir
$path = Join-Path (Join-Path $root '.claude') 'ag.json'
$c = Read-AgConfig $path

if ($Mode -eq 'status') {
    if (Test-FableOn $c) { Write-Host ('fable-planning: on (' + $path + ')') }
    else { Write-Host ('fable-planning: off (' + $root + ')') }
    exit 0
}

if ($Mode -eq 'on') {
    if (Test-FableOn $c) {
        Write-Host ('skip: fable-planning is already on (' + $path + ')')
        exit 0
    }
    if (Test-Prop $c 'fablePlanning') { $c.fablePlanning = $true }
    else { $c | Add-Member -NotePropertyName 'fablePlanning' -NotePropertyValue $true }
    Save-AgConfig $path $c
    Write-Host ('done: fable-planning on (' + $path + ')')
    exit 0
}

# off
if (-not (Test-Prop $c 'fablePlanning')) {
    Write-Host ('skip: fable-planning is already off (' + $root + ')')
    exit 0
}
$c.PSObject.Properties.Remove('fablePlanning')
if (@($c.PSObject.Properties).Count -eq 0) {
    Remove-Item -LiteralPath $path -Force
    Write-Host ('done: fable-planning off (removed ' + $path + ')')
}
else {
    Save-AgConfig $path $c
    Write-Host ('done: fable-planning off (' + $path + ')')
}
exit 0
