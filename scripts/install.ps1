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
      - Before the installs the marketplace is refreshed and every plugin
        already installed at an older version than the marketplace offers is
        updated, so a rerun once all are current prints only "skip:" lines.

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

# The plugins this marketplace ships. The list is used to install, to refresh
# and to update, so a new plugin is added in one place.
$AgentsPlugins = @('ag')

# The three plugins the marketplace used to ship, now folded into ag. Each is
# uninstalled before ag is installed, so two copies of the goal-progress mod
# never load at once.
$OldAgentsPlugins = @('goal-prompt', 'goal-prompt-3rdparty', 'goal-progress')

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

# Windows PowerShell 5.1 turns a JSON array into one object that @() wraps once
# more, so the parsed list is copied out element by element: callers then loop
# over one plugin per turn, not over the whole list in a single turn.
function Get-PluginList {
    if ($null -eq $script:PluginList) {
        $json = (Invoke-Claude @('plugin', 'list', '--json') -Capture) -join "`n"
        $script:PluginList = @()
        foreach ($p in @(ConvertFrom-Json -InputObject $json)) { $script:PluginList += $p }
    }
    return $script:PluginList
}

function Get-MarketplaceList {
    if ($null -eq $script:MarketplaceList) {
        $json = (Invoke-Claude @('plugin', 'marketplace', 'list', '--json') -Capture) -join "`n"
        $script:MarketplaceList = @()
        foreach ($m in @(ConvertFrom-Json -InputObject $json)) { $script:MarketplaceList += $m }
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

function Get-InstalledVersion([string]$Id) {
    foreach ($p in @(Get-PluginList)) {
        if ($p.id -eq $Id) { return $p.version }
    }
    return $null
}

# The version this checkout ships for a plugin (the copy the marketplace is
# built from), or $null when it does not ship one.
function Get-CheckoutVersion([string]$Name) {
    $p = Join-Path $Checkout ('plugins/' + $Name + '/.claude-plugin/plugin.json')
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    return ([System.IO.File]::ReadAllText($p) | ConvertFrom-Json).version
}

# The version the added agents-plugin marketplace offers for a plugin, read from
# its own catalog clone. $null when the marketplace or the entry is unknown.
function Get-OfferedVersion([string]$Name) {
    $mp = $null
    foreach ($m in @(Get-MarketplaceList)) {
        if ($m.name -eq 'agents-plugin') { $mp = $m.installLocation }
    }
    if (-not $mp) { return $null }
    $catPath = Join-Path $mp '.claude-plugin/marketplace.json'
    if (-not (Test-Path -LiteralPath $catPath)) { return $null }
    $cat = [System.IO.File]::ReadAllText($catPath) | ConvertFrom-Json
    $entry = @($cat.plugins | Where-Object { $_.name -eq $Name })
    if ($entry.Count -eq 0) { return $null }
    $src = [string]$entry[0].source
    if (-not $src.StartsWith('./')) { return $null }
    $rel = ($src.Substring(2) -replace '/', '\')
    $pj = Join-Path $mp ($rel + '\.claude-plugin\plugin.json')
    if (-not (Test-Path -LiteralPath $pj)) { return $null }
    return ([System.IO.File]::ReadAllText($pj) | ConvertFrom-Json).version
}

# Refresh the marketplace when a plugin is missing, or when one is installed at
# a version other than the one this checkout ships. When the marketplace is not
# added yet, the add step clones it fresh, so no refresh is needed here.
function Test-NeedsMarketplaceRefresh {
    if (-not (Test-MarketplaceKnown 'agents-plugin')) { return $false }
    foreach ($name in $AgentsPlugins) {
        $id = $name + '@agents-plugin'
        if (Test-NeedsPlugin $id) { return $true }
        $installed = Get-InstalledVersion $id
        $want = Get-CheckoutVersion $name
        if ($installed -and $want -and ($installed -ne $want)) { return $true }
    }
    return $false
}

# An installed plugin whose version is not the one the marketplace offers.
function Test-NeedsPluginUpdate([string]$Name) {
    $installed = Get-InstalledVersion ($Name + '@agents-plugin')
    if (-not $installed) { return $false }
    $offered = Get-OfferedVersion $Name
    if (-not $offered) { $offered = Get-CheckoutVersion $Name }
    if (-not $offered) { return $false }
    return ($installed -ne $offered)
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

# The plugin names settings.json must not keep: the local-mods copy and the
# three plugins the marketplace used to ship, which ag replaces.
function Get-StalePluginNames {
    $names = @('goal-progress@local-mods')
    foreach ($old in $OldAgentsPlugins) { $names += $old + '@agents-plugin' }
    return $names
}

# --- what each action would change (also decides whether a backup is worth it)
function Test-NeedsStaleDrop {
    $s = Read-Settings
    if (Test-Prop $s 'enabledPlugins') {
        foreach ($name in Get-StalePluginNames) {
            if (Test-Prop $s.enabledPlugins $name) { return $true }
        }
    }
    ((Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'local-mods'))
}

function Test-NeedsMarketplaceAdd {
    -not (Test-MarketplaceKnown 'agents-plugin')
}

function Test-NeedsPlugin([string]$Id) {
    -not (Test-PluginInstalled $Id)
}

# Any of the three old plugins still installed (as a plugin copy).
function Test-NeedsOldPluginUninstall {
    foreach ($old in $OldAgentsPlugins) {
        if (Test-PluginInstalled ($old + '@agents-plugin')) { return $true }
    }
    return $false
}

function Test-NeedsSettingsSync {
    $s = Read-Settings
    (-not ((Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'agents-plugin'))) -or
    (-not ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'ag@agents-plugin')))
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

# The key entry point: plugins/ag/scripts/ag-key.ps1 with this checkout's path filled in.
function Get-AgKeyPath { Join-Path (Join-Path $ClaudeHome 'ag') 'ag-key.ps1' }

function Get-AgKeyText {
    $src = [System.IO.File]::ReadAllText((Join-Path $Checkout 'plugins/ag/scripts/ag-key.ps1'))
    return $src.Replace("'__AG_CHECKOUT__'", "'" + $Checkout.Replace("'", "''") + "'")
}

function Test-NeedsAgKey {
    $p = Get-AgKeyPath
    (-not (Test-Path -LiteralPath $p -PathType Leaf)) -or
    ([System.IO.File]::ReadAllText($p) -cne (Get-AgKeyText))
}

# The review page entry point: plugins/ag/scripts/review-page-entry.ps1 with this checkout's path filled in.
function Get-ReviewPagePath { Join-Path (Join-Path $ClaudeHome 'ag') 'review-page.ps1' }

function Get-ReviewPageText {
    $src = [System.IO.File]::ReadAllText((Join-Path $Checkout 'plugins/ag/scripts/review-page-entry.ps1'))
    return $src.Replace("'__AG_CHECKOUT__'", "'" + $Checkout.Replace("'", "''") + "'")
}

function Test-NeedsReviewPage {
    $p = Get-ReviewPagePath
    (-not (Test-Path -LiteralPath $p -PathType Leaf)) -or
    ([System.IO.File]::ReadAllText($p) -cne (Get-ReviewPageText))
}

function Test-AnythingToDo {
    (Test-NeedsStaleDrop) -or
    (Test-NeedsMarketplaceAdd) -or
    (Test-NeedsMarketplaceRefresh) -or
    (Test-NeedsOldPluginUninstall) -or
    (Test-NeedsPlugin 'ag@agents-plugin') -or
    (Test-NeedsPluginUpdate 'ag') -or
    (Test-NeedsSettingsSync) -or
    (Test-NeedsMove 'skills/goal-prompt') -or
    (Test-NeedsMove 'skills/goal-prompt-3rdparty') -or
    (Test-NeedsBinMove) -or
    (Test-NeedsMove 'mods/goal-progress') -or
    (Test-NeedsClaudeMd) -or
    (Test-NeedsAgKey) -or
    (Test-NeedsReviewPage)
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

Step 'settings.json: drop the local-mods and old plugin names' {
    Test-NeedsStaleDrop
} {
    $s = Read-Settings
    if (Test-Prop $s 'enabledPlugins') {
        foreach ($name in Get-StalePluginNames) {
            if (Test-Prop $s.enabledPlugins $name) {
                $s.enabledPlugins.PSObject.Properties.Remove($name)
            }
        }
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

# Refresh the marketplace before installing, then bring every plugin already
# installed up to the version it offers. Both print skip when all are current.
Step 'claude plugin marketplace update agents-plugin' {
    Test-NeedsMarketplaceRefresh
} {
    Invoke-Claude @('plugin', 'marketplace', 'update', 'agents-plugin')
}

# The loop variable is not called $name: Step's own parameter is $Name, and
# PowerShell matches variable names without case, so $name inside these blocks
# would be the action label instead of the plugin.
foreach ($plugin in $AgentsPlugins) {
    Step ('claude plugin update ' + $plugin + '@agents-plugin') {
        Test-NeedsPluginUpdate $plugin
    } {
        Invoke-Claude @('plugin', 'update', ($plugin + '@agents-plugin'))
    }
}

# Uninstall the three old plugins before installing ag, so the goal-progress mod
# is never loaded from two plugin copies at once.
foreach ($old in $OldAgentsPlugins) {
    Step ('claude plugin uninstall ' + $old + '@agents-plugin') {
        Test-PluginInstalled ($old + '@agents-plugin')
    } {
        Invoke-Claude @('plugin', 'uninstall', ($old + '@agents-plugin'))
    }
}

Step 'claude plugin install ag@agents-plugin' {
    Test-NeedsPlugin 'ag@agents-plugin'
} {
    Invoke-Claude @('plugin', 'install', 'ag@agents-plugin')
}

Step 'settings.json: name the agents-plugin marketplace and the ag plugin' {
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
    foreach ($plugin in ($AgentsPlugins | ForEach-Object { $_ + '@agents-plugin' })) {
        if (-not (Test-Prop $s.enabledPlugins $plugin)) {
            $s.enabledPlugins | Add-Member -NotePropertyName $plugin -NotePropertyValue $true
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

# --- the key entry point, ~/.claude/ag/ag-key.ps1, works from any folder ----
Step ('write ' + (Get-AgKeyPath) + ' (key entry point)') {
    Test-NeedsAgKey
} {
    New-Dir (Split-Path -Parent (Get-AgKeyPath))
    [System.IO.File]::WriteAllText((Get-AgKeyPath), (Get-AgKeyText), (New-Object System.Text.UTF8Encoding($false)))
}

# --- the review page entry point, ~/.claude/ag/review-page.ps1, works from any folder ----
Step ('write ' + (Get-ReviewPagePath) + ' (review page entry point)') {
    Test-NeedsReviewPage
} {
    New-Dir (Split-Path -Parent (Get-ReviewPagePath))
    [System.IO.File]::WriteAllText((Get-ReviewPagePath), (Get-ReviewPageText), (New-Object System.Text.UTF8Encoding($false)))
}
