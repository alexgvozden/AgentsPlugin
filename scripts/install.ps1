<#
    install.ps1 - switch this machine from the old user-level goal tooling to
    the AgentsPlugin plugins (marketplace "agents-plugin").

    Behaviour
      - Every action prints one line before it acts. -WhatIf prints those lines
        and changes nothing. A real action prints "done: <action>"; an action
        already in place prints "skip: <action>", so a second run changes nothing.
      - A backup is taken only when some later action will change something, so
        a rerun on another day changes nothing and makes no backup folder.
      - Old user-level copies are moved (never deleted) to
        <home>\backup-<yyyyMMdd>\ keeping their relative paths; a name already
        taken there gets a time suffix. settings.json and CLAUDE.md are copied
        there before they change.
      - ext-build.json, secrets\ and the *.bak-* files are left alone.
      - Whether the plugins are installed is read from the CLI
        (claude plugin list --json), not from settings.json.

    Parameters
      -ClaudeHome <dir>  the Claude config folder (default ~/.claude). When it is
                         not the default, CLAUDE_CONFIG_DIR is set to it for this
                         script's own claude calls and restored right after each
                         one, so the caller's shell is never changed. An inherited
                         CLAUDE_CONFIG_DIR pointing elsewhere stops the script.
      -WhatIf            print the actions, change nothing.
      -Today <yyyyMMdd>  pretend that day for the backup folder name. Test only.

    Windows PowerShell 5.1 compatible.
#>
param(
    [string]$ClaudeHome = (Join-Path $HOME '.claude'),
    [switch]$WhatIf,
    [string]$Today = ''
)

$ErrorActionPreference = 'Stop'

function Get-CleanPath([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

# The checkout is this script's folder (scripts\) one level up.
$Checkout = Get-CleanPath (Join-Path $PSScriptRoot '..')
$CheckoutFwd = $Checkout -replace '\\', '/'
$ImportLine = '@' + $CheckoutFwd + '/rules/CLAUDE.global.md'

$ClaudeHome = Get-CleanPath $ClaudeHome
if (-not (Test-Path -LiteralPath $ClaudeHome)) {
    throw "ClaudeHome not found: $ClaudeHome"
}

$DefaultHome = Get-CleanPath (Join-Path $HOME '.claude')
$InheritedConfigDir = $env:CLAUDE_CONFIG_DIR
if ($InheritedConfigDir) {
    if ((Get-CleanPath $InheritedConfigDir) -ne $ClaudeHome) {
        throw ('CLAUDE_CONFIG_DIR is already set to ' + $InheritedConfigDir +
            ', which is not ClaudeHome (' + $ClaudeHome +
            '); unset it, or pass -ClaudeHome ' + $InheritedConfigDir + '.')
    }
}
# Set for this script's own claude calls only; Invoke-Claude puts it back right
# after each call, so nothing leaks into the caller's shell.
$ConfigDirForCalls = $null
if ($ClaudeHome -ne $DefaultHome) { $ConfigDirForCalls = $ClaudeHome }

$TodayStamp = $Today
if (-not $TodayStamp) { $TodayStamp = Get-Date -Format 'yyyyMMdd' }
if ($TodayStamp -notmatch '^\d{8}$') { throw "-Today must be yyyyMMdd: $Today" }
$BackupDir = Join-Path $ClaudeHome ('backup-' + $TodayStamp)

function Get-SettingsPath { Join-Path $ClaudeHome 'settings.json' }

function Read-Settings {
    $p = Get-SettingsPath
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    return ([System.IO.File]::ReadAllText($p) | ConvertFrom-Json)
}

function Save-Settings($Settings) {
    $json = $Settings | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText((Get-SettingsPath), $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-Prop($Object, [string]$Name) {
    if ($null -eq $Object) { return $false }
    return ($Object.PSObject.Properties.Name -contains $Name)
}

function New-Dir([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

# What the CLI knows, asked once per run and asked again after it changes.
$PluginList = $null
$MarketplaceList = $null

function Invoke-Claude([string[]]$Arguments, [switch]$Capture) {
    $saved = $env:CLAUDE_CONFIG_DIR
    if ($ConfigDirForCalls) { $env:CLAUDE_CONFIG_DIR = $ConfigDirForCalls }
    try {
        if ($Capture) {
            $out = & claude @Arguments
        }
        else {
            & claude @Arguments
            $out = $null
        }
        $code = $LASTEXITCODE
    }
    finally {
        $env:CLAUDE_CONFIG_DIR = $saved
    }
    if ($code -ne 0) {
        throw ('claude ' + ($Arguments -join ' ') + ' failed with exit ' + $code)
    }
    if (-not $Capture) {
        # the CLI just changed something: forget what we knew about it
        $script:PluginList = $null
        $script:MarketplaceList = $null
    }
    return $out
}

function Get-PluginList {
    if ($null -eq $script:PluginList) {
        $json = (Invoke-Claude @('plugin', 'list', '--json') -Capture) -join "`n"
        $script:PluginList = @(ConvertFrom-Json -InputObject $json)
    }
    return $script:PluginList
}

function Get-MarketplaceList {
    if ($null -eq $script:MarketplaceList) {
        $json = (Invoke-Claude @('plugin', 'marketplace', 'list', '--json') -Capture) -join "`n"
        $script:MarketplaceList = @(ConvertFrom-Json -InputObject $json)
    }
    return $script:MarketplaceList
}

function Test-PluginInstalled([string]$Id) {
    foreach ($p in @(Get-PluginList)) {
        if ($p.id -eq $Id) { return $true }
    }
    return $false
}

function Test-MarketplaceKnown([string]$Name) {
    foreach ($m in @(Get-MarketplaceList)) {
        if ($m.name -eq $Name) { return $true }
    }
    return $false
}

# One action: print "skip: <name>" if it is already in place, else print the
# action line, do it (unless -WhatIf) and print "done: <name>".
function Step([string]$Name, [scriptblock]$Needed, [scriptblock]$Do) {
    if (-not (& $Needed)) {
        Write-Host ('skip: ' + $Name)
        return
    }
    Write-Host ('do: ' + $Name)
    if ($WhatIf) { return }
    & $Do
    Write-Host ('done: ' + $Name)
}

# A free name under the backup folder: the relative path, with a time suffix if
# something is already there (never nest, never overwrite).
function New-BackupPath([string]$Relative) {
    $target = Join-Path $BackupDir $Relative
    if (Test-Path -LiteralPath $target) {
        $stamp = Get-Date -Format 'HHmmss'
        $candidate = $target + '-' + $stamp
        $n = 1
        while (Test-Path -LiteralPath $candidate) {
            $candidate = $target + '-' + $stamp + '-' + $n
            $n = $n + 1
        }
        $target = $candidate
    }
    return $target
}

function Move-ToBackup([string]$Relative) {
    $source = Join-Path $ClaudeHome $Relative
    $target = New-BackupPath $Relative
    New-Dir (Split-Path -Parent $target)
    Move-Item -LiteralPath $source -Destination $target
}

# --- what each action would change (also decides whether a backup is worth it)
function Test-NeedsLocalModsDrop {
    $s = Read-Settings
    ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-progress@local-mods')) -or
    ((Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'local-mods'))
}

function Test-NeedsMarketplaceAdd {
    -not (Test-MarketplaceKnown 'agents-plugin')
}

function Test-NeedsPlugin([string]$Id) {
    -not (Test-PluginInstalled $Id)
}

function Test-NeedsSettingsSync {
    $s = Read-Settings
    (-not ((Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'agents-plugin'))) -or
    (-not ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-prompt@agents-plugin'))) -or
    (-not ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-progress@agents-plugin')))
}

function Test-NeedsMove([string]$Relative) {
    Test-Path -LiteralPath (Join-Path $ClaudeHome $Relative)
}

function Test-NeedsBinMove {
    @(Get-ChildItem -Path (Join-Path $ClaudeHome 'bin') -Filter 'ext-build*' -File -ErrorAction SilentlyContinue).Count -gt 0
}

function Test-NeedsClaudeMd {
    $p = Join-Path $ClaudeHome 'CLAUDE.md'
    (-not (Test-Path -LiteralPath $p)) -or
    (-not ([System.IO.File]::ReadAllText($p).Contains($ImportLine)))
}

function Test-AnythingToDo {
    (Test-NeedsLocalModsDrop) -or
    (Test-NeedsMarketplaceAdd) -or
    (Test-NeedsPlugin 'goal-prompt@agents-plugin') -or
    (Test-NeedsPlugin 'goal-progress@agents-plugin') -or
    (Test-NeedsSettingsSync) -or
    (Test-NeedsMove 'skills/goal-prompt') -or
    (Test-NeedsMove 'skills/goal-prompt-3rdparty') -or
    (Test-NeedsBinMove) -or
    (Test-NeedsMove 'mods/goal-progress') -or
    (Test-NeedsClaudeMd)
}

# --- settings.json is copied to the backup before anything can change it ----
Step ('backup settings.json -> ' + $BackupDir) {
    (Test-Path -LiteralPath (Get-SettingsPath)) -and (Test-AnythingToDo)
} {
    New-Dir $BackupDir
    $target = New-BackupPath 'settings.json'
    Copy-Item -LiteralPath (Get-SettingsPath) -Destination $target
}

# --- remove the local-mods copy with the CLI first --------------------------
Step 'claude plugin uninstall goal-progress@local-mods' {
    $s = Read-Settings
    (Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-progress@local-mods')
} {
    Invoke-Claude @('plugin', 'uninstall', 'goal-progress@local-mods')
}

Step 'claude plugin marketplace remove local-mods' {
    $s = Read-Settings
    (Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'local-mods')
} {
    Invoke-Claude @('plugin', 'marketplace', 'remove', 'local-mods')
}

Step 'settings.json: drop every local-mods name' {
    Test-NeedsLocalModsDrop
} {
    $s = Read-Settings
    if ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-progress@local-mods')) {
        $s.enabledPlugins.PSObject.Properties.Remove('goal-progress@local-mods')
    }
    if ((Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'local-mods')) {
        $s.extraKnownMarketplaces.PSObject.Properties.Remove('local-mods')
    }
    Save-Settings $s
}

# --- install the plugins from this checkout ---------------------------------
# "already there" comes from the CLI, so a settings.json entry that the CLI does
# not know about cannot make the script skip an install it still needs.
Step 'claude plugin marketplace add alexgvozden/AgentsPlugin' {
    Test-NeedsMarketplaceAdd
} {
    Invoke-Claude @('plugin', 'marketplace', 'add', 'alexgvozden/AgentsPlugin')
}

Step 'claude plugin install goal-prompt@agents-plugin' {
    Test-NeedsPlugin 'goal-prompt@agents-plugin'
} {
    Invoke-Claude @('plugin', 'install', 'goal-prompt@agents-plugin')
}

Step 'claude plugin install goal-progress@agents-plugin' {
    Test-NeedsPlugin 'goal-progress@agents-plugin'
} {
    Invoke-Claude @('plugin', 'install', 'goal-progress@agents-plugin')
}

Step 'settings.json: name the agents-plugin marketplace and both plugins' {
    Test-NeedsSettingsSync
} {
    $s = Read-Settings
    if ($null -eq $s) { $s = [PSCustomObject]@{} }
    if (-not (Test-Prop $s 'extraKnownMarketplaces')) {
        $s | Add-Member -NotePropertyName 'extraKnownMarketplaces' -NotePropertyValue ([PSCustomObject]@{})
    }
    if (-not (Test-Prop $s.extraKnownMarketplaces 'agents-plugin')) {
        $source = [PSCustomObject]@{ source = 'github'; repo = 'alexgvozden/AgentsPlugin' }
        $s.extraKnownMarketplaces | Add-Member -NotePropertyName 'agents-plugin' -NotePropertyValue ([PSCustomObject]@{ source = $source })
    }
    if (-not (Test-Prop $s 'enabledPlugins')) {
        $s | Add-Member -NotePropertyName 'enabledPlugins' -NotePropertyValue ([PSCustomObject]@{})
    }
    foreach ($name in @('goal-prompt@agents-plugin', 'goal-progress@agents-plugin')) {
        if (-not (Test-Prop $s.enabledPlugins $name)) {
            $s.enabledPlugins | Add-Member -NotePropertyName $name -NotePropertyValue $true
        }
    }
    Save-Settings $s
}

# --- move the old user-level copies to the backup ---------------------------
Step 'move skills\goal-prompt -> backup' {
    Test-NeedsMove 'skills/goal-prompt'
} {
    Move-ToBackup 'skills/goal-prompt'
}

Step 'move skills\goal-prompt-3rdparty -> backup' {
    Test-NeedsMove 'skills/goal-prompt-3rdparty'
} {
    Move-ToBackup 'skills/goal-prompt-3rdparty'
}

Step 'move bin\ext-build* -> backup' {
    Test-NeedsBinMove
} {
    Get-ChildItem -Path (Join-Path $ClaudeHome 'bin') -Filter 'ext-build*' -File | ForEach-Object {
        Move-ToBackup ('bin/' + $_.Name)
    }
}

Step 'move mods\goal-progress -> backup' {
    Test-NeedsMove 'mods/goal-progress'
} {
    Move-ToBackup 'mods/goal-progress'
}

# --- point CLAUDE.md at the global rules in this checkout -------------------
Step 'CLAUDE.md: import rules/CLAUDE.global.md' {
    Test-NeedsClaudeMd
} {
    $p = Join-Path $ClaudeHome 'CLAUDE.md'
    if (Test-Path -LiteralPath $p) {
        $backup = New-BackupPath 'CLAUDE.md'
        New-Dir (Split-Path -Parent $backup)
        Copy-Item -LiteralPath $p -Destination $backup
    }
    [System.IO.File]::WriteAllText($p, $ImportLine + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
}
