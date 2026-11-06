<#
    install.ps1 - switch this machine from the old user-level goal tooling to
    the AgentsPlugin plugins (marketplace "agents-plugin").

    Behaviour
      - Every action prints one line before it acts. -WhatIf prints those lines
        and changes nothing. A real action prints "done: <action>"; an action
        already in place prints "skip: <action>", so a second run changes nothing.
      - Old user-level copies are moved (never deleted) to
        <home>\backup-<yyyyMMdd>\ keeping their relative paths. settings.json
        and CLAUDE.md are copied there before they change.
      - ext-build.json, secrets\ and the *.bak-* files are left alone.

    Parameters
      -ClaudeHome <dir>  the Claude config folder (default ~/.claude). When it is
                         not the default, CLAUDE_CONFIG_DIR is set to it for the
                         claude calls, so the real config is never touched.
      -WhatIf            print the actions, change nothing.

    Windows PowerShell 5.1 compatible.
#>
param(
    [string]$ClaudeHome = (Join-Path $HOME '.claude'),
    [switch]$WhatIf
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
if ($ClaudeHome -ne $DefaultHome) {
    $env:CLAUDE_CONFIG_DIR = $ClaudeHome
}

$BackupDir = Join-Path $ClaudeHome ('backup-' + (Get-Date -Format 'yyyyMMdd'))

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

function Invoke-Claude([string[]]$Arguments) {
    & claude @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('claude ' + ($Arguments -join ' ') + ' failed with exit ' + $LASTEXITCODE)
    }
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

function Move-ToBackup([string]$Relative) {
    $source = Join-Path $ClaudeHome $Relative
    $target = Join-Path $BackupDir $Relative
    New-Dir (Split-Path -Parent $target)
    Move-Item -LiteralPath $source -Destination $target
}

# --- settings.json is copied to the backup before anything can change it ----
Step ('backup settings.json -> ' + $BackupDir) {
    (Test-Path -LiteralPath (Get-SettingsPath)) -and
    (-not (Test-Path -LiteralPath (Join-Path $BackupDir 'settings.json')))
} {
    New-Dir $BackupDir
    Copy-Item -LiteralPath (Get-SettingsPath) -Destination (Join-Path $BackupDir 'settings.json')
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
    $s = Read-Settings
    ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-progress@local-mods')) -or
    ((Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'local-mods'))
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
Step 'claude plugin marketplace add alexgvozden/AgentsPlugin' {
    $s = Read-Settings
    -not ((Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'agents-plugin'))
} {
    Invoke-Claude @('plugin', 'marketplace', 'add', 'alexgvozden/AgentsPlugin')
}

Step 'claude plugin install goal-prompt@agents-plugin' {
    $s = Read-Settings
    -not ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-prompt@agents-plugin'))
} {
    Invoke-Claude @('plugin', 'install', 'goal-prompt@agents-plugin')
}

Step 'claude plugin install goal-progress@agents-plugin' {
    $s = Read-Settings
    -not ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-progress@agents-plugin'))
} {
    Invoke-Claude @('plugin', 'install', 'goal-progress@agents-plugin')
}

Step 'settings.json: name the agents-plugin marketplace and both plugins' {
    $s = Read-Settings
    (-not ((Test-Prop $s 'extraKnownMarketplaces') -and (Test-Prop $s.extraKnownMarketplaces 'agents-plugin'))) -or
    (-not ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-prompt@agents-plugin'))) -or
    (-not ((Test-Prop $s 'enabledPlugins') -and (Test-Prop $s.enabledPlugins 'goal-progress@agents-plugin')))
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
    Test-Path -LiteralPath (Join-Path $ClaudeHome 'skills/goal-prompt')
} {
    Move-ToBackup 'skills/goal-prompt'
}

Step 'move skills\goal-prompt-3rdparty -> backup' {
    Test-Path -LiteralPath (Join-Path $ClaudeHome 'skills/goal-prompt-3rdparty')
} {
    Move-ToBackup 'skills/goal-prompt-3rdparty'
}

Step 'move bin\ext-build* -> backup' {
    @(Get-ChildItem -Path (Join-Path $ClaudeHome 'bin') -Filter 'ext-build*' -File -ErrorAction SilentlyContinue).Count -gt 0
} {
    Get-ChildItem -Path (Join-Path $ClaudeHome 'bin') -Filter 'ext-build*' -File | ForEach-Object {
        Move-ToBackup ('bin/' + $_.Name)
    }
}

Step 'move mods\goal-progress -> backup' {
    Test-Path -LiteralPath (Join-Path $ClaudeHome 'mods/goal-progress')
} {
    Move-ToBackup 'mods/goal-progress'
}

# --- point CLAUDE.md at the global rules in this checkout -------------------
Step 'CLAUDE.md: import rules/CLAUDE.global.md' {
    $p = Join-Path $ClaudeHome 'CLAUDE.md'
    (-not (Test-Path -LiteralPath $p)) -or
    (-not ([System.IO.File]::ReadAllText($p).Contains($ImportLine)))
} {
    $p = Join-Path $ClaudeHome 'CLAUDE.md'
    if (Test-Path -LiteralPath $p) {
        $backup = Join-Path $BackupDir 'CLAUDE.md'
        if (-not (Test-Path -LiteralPath $backup)) {
            New-Dir $BackupDir
            Copy-Item -LiteralPath $p -Destination $backup
        }
    }
    [System.IO.File]::WriteAllText($p, $ImportLine + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
}
