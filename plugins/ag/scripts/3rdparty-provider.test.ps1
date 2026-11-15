# Self-test for 3rdparty-provider.ps1 (no Pester). Uses temp files and a fake home only, so no real key
# or config is read. Run: powershell -NoProfile -ExecutionPolicy Bypass -File 3rdparty-provider.test.ps1
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '3rdparty-provider.ps1'
$script:fail = 0
$script:pass = 0

function Assert([bool]$Cond, [string]$Name, [string]$Detail = '') {
    if ($Cond) { $script:pass++; Write-Host "PASS $Name" }
    else { $script:fail++; Write-Host "FAIL $Name" -ForegroundColor Red; if ($Detail) { Write-Host $Detail } }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('3rdparty-provider-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$home2 = Join-Path $root 'home'
New-Item -ItemType Directory -Path (Join-Path $home2 '.claude') -Force | Out-Null
$cfg = Join-Path $root 'ext-build.json'

function Run([string[]]$ArgList) {
    $saved = $env:USERPROFILE
    $env:USERPROFILE = $home2
    try { $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script @ArgList 2>&1 | Out-String }
    finally { $env:USERPROFILE = $saved }
    [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

function Read-Json([string]$Path) { [IO.File]::ReadAllText($Path) | ConvertFrom-Json }

try {
    # status on a missing file: plugin default, nothing written
    $r = Run @('-ConfigPath', $cfg)
    Assert ($r.Code -eq 0 -and $r.Out -match 'provider: fireworks' -and $r.Out -match 'accounts/fireworks/models/deepseek-v4p1-flash-1017' -and $r.Out -match 'not there yet') 'status on a missing file shows the plugin default' $r.Out
    Assert ($r.Out -match 'key: not set for fireworks' -and $r.Out -match 'ag-key\.ps1 set fireworks') 'status names the key command when no key is set' $r.Out
    Assert (-not (Test-Path $cfg)) 'status writes nothing'

    # set creates the file
    $r = Run @('openrouter', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 0 -and $r.Out -match 'done: builders run on openrouter \(created') 'set creates the file' $r.Out
    Assert ((Read-Json $cfg).provider -eq 'openrouter') 'created file names the provider'
    Assert ($r.Out -match 'provider: openrouter \(OpenRouter\)' -and $r.Out -match 'default model: deepseek/deepseek-v4\.1-flash-1017' -and $r.Out -match 'ag-key\.ps1 set openrouter') 'status after set shows openrouter and its default model' $r.Out
    $bytes = [IO.File]::ReadAllBytes($cfg)
    Assert ($bytes[0] -eq [byte][char]'{') 'file is written without a BOM'

    $r = Run @('OpenRouter', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 0 -and $r.Out -match 'skip: builders already run on openrouter') 'second set is a skip (case does not matter)' $r.Out

    # a key in the provider's key file reads as set (a fake key file in the temp folder)
    $kf = Join-Path $root 'or.key'
    [IO.File]::WriteAllText($cfg, '{"provider":"openrouter","providers":{"openrouter":{"keyFile":"' + ($kf -replace '\\', '/') + '"}}}')
    if ($env:OS -eq 'Windows_NT') {
        $sec = ConvertTo-SecureString 'test-not-a-key' -AsPlainText -Force
        [IO.File]::WriteAllText($kf, (ConvertFrom-SecureString $sec))
        $r = Run @('status', '-ConfigPath', $cfg)
        Assert ($r.Out -match 'key: set for openrouter' -and $r.Out -notmatch 'test-not-a-key') 'status says set and never prints the key' $r.Out
    }

    # legacy flat file is migrated, other keys kept
    [IO.File]::WriteAllText($cfg, '{"provider":"fireworks","baseUrl":"https://api.fireworks.ai/inference","keyFile":"~/.claude/secrets/fireworks.key","defaultModel":"deepseek-v4p1-flash-1017","modelPrefix":"accounts/fireworks/models/","permissionMode":"bypassPermissions","maxBudgetUsd":25,"claudePath":"x"}')
    $r = Run @('openrouter', '-ConfigPath', $cfg)
    $j = Read-Json $cfg
    $names = @($j.PSObject.Properties | ForEach-Object { $_.Name })
    Assert ($r.Code -eq 0 -and $j.provider -eq 'openrouter') 'migration sets the provider' $r.Out
    Assert ($j.providers.fireworks.baseUrl -eq 'https://api.fireworks.ai/inference' -and $j.providers.fireworks.keyFile -eq '~/.claude/secrets/fireworks.key' -and $j.providers.fireworks.defaultModel -eq 'deepseek-v4p1-flash-1017' -and $j.providers.fireworks.modelPrefix -eq 'accounts/fireworks/models/') 'flat keys move under providers.fireworks' ($names -join ',')
    Assert ($j.permissionMode -eq 'bypassPermissions' -and $j.maxBudgetUsd -eq 25 -and $j.claudePath -eq 'x') 'migration keeps the other keys'
    Assert (-not ($names -contains 'baseUrl') -and -not ($names -contains 'defaultModel')) 'no flat keys left at the top'
    $r = Run @('fireworks', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 0 -and $r.Out -match 'default model: accounts/fireworks/models/deepseek-v4p1-flash-1017' -and (Read-Json $cfg).provider -eq 'fireworks') 'back to fireworks keeps the migrated settings' $r.Out

    # flat file without a provider belongs to fireworks
    [IO.File]::WriteAllText($cfg, '{"defaultModel":"kimi-k2","maxBudgetUsd":9}')
    $r = Run @('fireworks', '-ConfigPath', $cfg)
    $j = Read-Json $cfg
    Assert ($r.Code -eq 0 -and $j.providers.fireworks.defaultModel -eq 'kimi-k2' -and $j.maxBudgetUsd -eq 9 -and $r.Out -match 'default model: accounts/fireworks/models/kimi-k2') 'flat file without provider migrates to fireworks' $r.Out

    # bad input
    $r = Run @('gemini', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 2 -and $r.Out -match 'fireworks, openrouter or status') 'unknown argument exits 2' $r.Out
    [IO.File]::WriteAllText($cfg, '{ not json')
    $r = Run @('openrouter', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 2 -and ([IO.File]::ReadAllText($cfg) -eq '{ not json')) 'invalid JSON exits 2 and is left alone' $r.Out
    $r = Run @('status', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 2) 'status on invalid JSON exits 2' $r.Out
    [IO.File]::WriteAllText($cfg, '{"provider":"gemini"}')
    $r = Run @('status', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 2 -and $r.Out -match "unknown builder provider 'gemini'") 'status on an unknown configured provider exits 2' $r.Out

    # no -ConfigPath: the file in the (fake) home
    $r = Run @('openrouter')
    $hf = Join-Path $home2 '.claude\ext-build.json'
    Assert ($r.Code -eq 0 -and (Test-Path $hf) -and (Read-Json $hf).provider -eq 'openrouter') 'default path is ~/.claude/ext-build.json' $r.Out
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ("3rdparty-provider tests: {0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
