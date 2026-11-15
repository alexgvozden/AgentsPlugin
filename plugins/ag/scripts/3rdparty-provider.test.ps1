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
$script:epFile = Join-Path $root 'no-endpoints.json'

function Run([string[]]$ArgList) {
    $saved = $env:USERPROFILE
    $savedEp = $env:AG_OPENROUTER_ENDPOINTS_JSON
    $env:USERPROFILE = $home2
    # never the network: the endpoints list comes from a file (a missing one reads as offline)
    $env:AG_OPENROUTER_ENDPOINTS_JSON = $script:epFile
    try { $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script @ArgList 2>&1 | Out-String }
    finally { $env:USERPROFILE = $saved; $env:AG_OPENROUTER_ENDPOINTS_JSON = $savedEp }
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

    # OpenRouter routing (fake endpoints list, never the network)
    $eps = Join-Path $root 'endpoints.json'
    [IO.File]::WriteAllText($eps, '{"data":{"id":"deepseek/deepseek-v4.1-flash-1017","endpoints":[' +
        '{"provider_name":"Wafer","tag":"wafer/mxfp4","quantization":"fp4","pricing":{"prompt":"0.0000001","completion":"0.0000004"}},' +
        '{"provider_name":"DeepInfra","tag":"deepinfra/fp8","quantization":"fp8","pricing":{"prompt":"0.00000015","completion":"0.0000006"}},' +
        '{"provider_name":"DeepSeek","tag":"deepseek","quantization":"fp8","pricing":{"prompt":"0.0000002","completion":"0.0000008"}}]}}')
    $script:epFile = $eps
    Remove-Item -LiteralPath $cfg -Force
    $r = Run @('openrouter', 'wafer/mxfp4', '-ConfigPath', $cfg)
    $j = Read-Json $cfg
    Assert ($r.Code -eq 0 -and $j.provider -eq 'openrouter' -and (@($j.providers.openrouter.routing.only) -join ',') -eq 'wafer/mxfp4' -and $null -eq $j.providers.openrouter.routing.allow_fallbacks) 'a slug pins only that provider (only, no allow_fallbacks)' $r.Out
    Assert ($r.Out -match 'done: builders run on openrouter, routing only wafer/mxfp4' -and $r.Out -match 'routing: only wafer/mxfp4' -and $r.Out -notmatch 'warning') 'set and status print the routing' $r.Out
    Assert ($r.Out -match 'wafer/mxfp4: Wafer, fp4, \$0\.10 in / \$0\.40 out per 1M tokens') 'status prints the pinned endpoint price and quantization' $r.Out
    $r = Run @('openrouter', 'wafer/mxfp4', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 0 -and $r.Out -match 'skip: builders already run on openrouter, routing only wafer/mxfp4') 'the same route again is a skip' $r.Out
    $r = Run @('openrouter', 'deepinfra/fp8,', 'deepseek', '-ConfigPath', $cfg)
    $j = Read-Json $cfg
    Assert ($r.Code -eq 0 -and (@($j.providers.openrouter.routing.only) -join ',') -eq 'deepinfra/fp8,deepseek' -and $r.Out -match 'deepinfra/fp8: DeepInfra, fp8' -and $r.Out -match 'deepseek: DeepSeek, fp8') 'a list of slugs (also split by a space) pins them in order' $r.Out
    $r = Run @('openrouter', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 0 -and $r.Out -match 'skip: builders already run on openrouter \(' -and (@((Read-Json $cfg).providers.openrouter.routing.only) -join ',') -eq 'deepinfra/fp8,deepseek') 'no second argument keeps the routing' $r.Out
    foreach ($pair in @(@('cheapest', 'price'), @('fastest', 'throughput'), @('quickest-start', 'latency'))) {
        $r = Run @('openrouter', $pair[0], '-ConfigPath', $cfg)
        $ro = (Read-Json $cfg).providers.openrouter.routing
        Assert ($r.Code -eq 0 -and $ro.sort -eq $pair[1] -and @($ro.PSObject.Properties).Count -eq 1 -and $r.Out -match ('routing: ' + $pair[0])) ($pair[0] + ' sorts by ' + $pair[1]) $r.Out
    }
    $r = Run @('fireworks', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 0 -and (Read-Json $cfg).providers.openrouter.routing.sort -eq 'latency' -and $r.Out -match 'openrouter routing: quickest-start \(applies when the builders run on openrouter\)') 'fireworks keeps the openrouter routing and names it' $r.Out
    $r = Run @('openrouter', 'auto', '-ConfigPath', $cfg)
    $j = Read-Json $cfg
    Assert ($r.Code -eq 0 -and $j.provider -eq 'openrouter' -and $null -eq $j.PSObject.Properties['providers'] -and $r.Out -match 'routing: auto') 'auto removes the routing (and an emptied entry)' $r.Out
    [IO.File]::WriteAllText($cfg, '{"provider":"openrouter","providers":{"openrouter":{"defaultModel":"x/y","routing":{"sort":"price"}}}}')
    $r = Run @('openrouter', 'auto', '-ConfigPath', $cfg)
    $j = Read-Json $cfg
    Assert ($r.Code -eq 0 -and $j.providers.openrouter.defaultModel -eq 'x/y' -and $null -eq $j.providers.openrouter.PSObject.Properties['routing']) 'auto keeps the other openrouter settings' $r.Out
    $r = Run @('openrouter', 'auto', '-ConfigPath', $cfg)
    Assert ($r.Out -match 'skip: builders already run on openrouter, routing auto') 'auto without a routing is a skip' $r.Out

    # unknown slug: a warning with the valid tags, still saved
    $r = Run @('openrouter', 'nosuch', '-ConfigPath', (Join-Path $root 'u.json'))
    Assert ($r.Code -eq 0 -and $r.Out -match 'warning: .*has no OpenRouter endpoint "nosuch"; saved anyway' -and $r.Out -match 'valid for deepseek/deepseek-v4\.1-flash-1017: deepinfra/fp8, deepseek, wafer/mxfp4' -and (@((Read-Json (Join-Path $root 'u.json')).providers.openrouter.routing.only) -join ',') -eq 'nosuch') 'unknown slug warns with the valid tags and is saved' $r.Out
    $r = Run @('openrouter', 'wafer', '-ConfigPath', (Join-Path $root 'u.json'))
    Assert ($r.Code -eq 0 -and $r.Out -notmatch 'warning' -and $r.Out -match 'wafer/mxfp4: Wafer') 'a provider slug matches its tagged endpoints' $r.Out
    # offline: the check is skipped
    $script:epFile = Join-Path $root 'missing-endpoints.json'
    $r = Run @('openrouter', 'wafer/mxfp4', '-ConfigPath', (Join-Path $root 'o.json'))
    Assert ($r.Code -eq 0 -and $r.Out -match 'provider check was skipped' -and $r.Out -notmatch 'warning' -and (Test-Path (Join-Path $root 'o.json'))) 'offline: the check is skipped and the route saved' $r.Out
    $script:epFile = $eps

    # bad routes
    $r = Run @('fireworks', 'wafer/mxfp4', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 2 -and $r.Out -match 'only goes with openrouter') 'a route with fireworks exits 2' $r.Out
    $r = Run @('status', 'cheapest', '-ConfigPath', $cfg)
    Assert ($r.Code -eq 2 -and $r.Out -match 'only goes with openrouter') 'a route with status exits 2' $r.Out
    $before = [IO.File]::ReadAllText($cfg)
    foreach ($bad in @('Wafer', 'wa fer!', 'a;b')) {
        $r = Run @('openrouter', $bad, '-ConfigPath', $cfg)
        Assert ($r.Code -eq 2 -and $r.Out -match 'is not a provider slug' -and [IO.File]::ReadAllText($cfg) -eq $before) ('bad slug "' + $bad + '" exits 2 and changes nothing') $r.Out
    }

    # flat file migration together with a route
    [IO.File]::WriteAllText($cfg, '{"provider":"fireworks","defaultModel":"kimi-k2","maxBudgetUsd":7}')
    $r = Run @('openrouter', 'deepseek', '-ConfigPath', $cfg)
    $j = Read-Json $cfg
    Assert ($r.Code -eq 0 -and $j.provider -eq 'openrouter' -and $j.providers.fireworks.defaultModel -eq 'kimi-k2' -and (@($j.providers.openrouter.routing.only) -join ',') -eq 'deepseek' -and $j.maxBudgetUsd -eq 7 -and $null -eq $j.PSObject.Properties['defaultModel']) 'flat file migrates and gets the route' $r.Out

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
