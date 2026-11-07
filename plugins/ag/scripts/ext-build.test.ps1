# Self-test for ext-build.ps1 (no Pester). Uses a temp config folder and a dummy DPAPI key;
# never reads the real key and never calls claude.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File ext-build.test.ps1
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'ext-build.ps1'
$script:fail = 0
$script:pass = 0

function Assert([bool]$Cond, [string]$Name, [string]$Detail = '') {
    if ($Cond) { $script:pass++; Write-Host "PASS $Name" }
    else { $script:fail++; Write-Host "FAIL $Name" -ForegroundColor Red; if ($Detail) { Write-Host $Detail } }
}

function Run-Launcher([string[]]$ArgList) {
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher @ArgList 2>&1 | Out-String
    [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

# Runs the launcher with a fake home folder, so the real ~/.claude is never read.
function Run-LauncherAs([string]$UserProfile, [string[]]$ArgList) {
    $old = $env:USERPROFILE
    try { $env:USERPROFILE = $UserProfile; return (Run-Launcher $ArgList) }
    finally { $env:USERPROFILE = $old }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('ext-build-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $dummy = 'fw-DUMMY-' + [guid]::NewGuid().ToString('N')
    $keyFile = Join-Path $root 'secrets\fireworks.key'
    New-Item -ItemType Directory -Path (Split-Path $keyFile) | Out-Null
    [IO.File]::WriteAllText($keyFile, (ConvertTo-SecureString $dummy -AsPlainText -Force | ConvertFrom-SecureString))

    function New-TestConfig([string]$Name, [string]$KeyPath) {
        $p = Join-Path $root $Name
        $cfg = [ordered]@{
            provider = 'fireworks'; baseUrl = 'https://api.fireworks.ai/inference'; keyFile = $KeyPath
            defaultModel = 'glm-5p3-flash'; modelPrefix = 'accounts/fireworks/models/'
            permissionMode = 'bypassPermissions'; maxBudgetUsd = 3
        }
        [IO.File]::WriteAllText($p, ((New-Object psobject -Property $cfg) | ConvertTo-Json))
        return $p
    }
    $cfgOk = New-TestConfig 'ok.json' $keyFile
    $cfgNoKey = New-TestConfig 'nokey.json' (Join-Path $root 'secrets\missing.key')
    $badKey = Join-Path $root 'secrets\bad.key'
    [IO.File]::WriteAllText($badKey, 'not-a-dpapi-blob')
    $cfgBadKey = New-TestConfig 'badkey.json' $badKey

    $brief = Join-Path $root 'brief.md'
    [IO.File]::WriteAllText($brief, "Step 1: say ""hello"" and 'bye'`nline two")
    $wt = Join-Path $root 'wt'; New-Item -ItemType Directory -Path $wt | Out-Null
    $logs = Join-Path $root 'logs'
    $common = @('-Brief', $brief, '-Cwd', $wt, '-Step', 'S1', '-LogDir', $logs, '-DryRun')

    # 1. default model resolves with prefix; key masked; nothing run
    $r = Run-Launcher (@('-Config', $cfgOk) + $common)
    Assert ($r.Code -eq 0) 'dryrun exit 0' $r.Out
    Assert ($r.Out -match 'model: accounts/fireworks/models/glm-5p3-flash') 'default model gets prefix' $r.Out
    Assert ($r.Out -match '--model\s+accounts/fireworks/models/glm-5p3-flash') 'args carry resolved model'
    Assert ($r.Out -match 'ANTHROPIC_AUTH_TOKEN=\*\*\*') 'key shown as ***'
    Assert (-not $r.Out.Contains($dummy)) 'dummy key never appears in dry-run output'
    Assert ($r.Out -match 'ANTHROPIC_DEFAULT_HAIKU_MODEL=accounts/fireworks/models/glm-5p3-flash') 'haiku alias pinned'
    Assert ($r.Out -match '--disallowedTools\s+Agent') 'Agent tool disallowed'
    Assert ($r.Out -match 'attribution') 'attribution settings passed'
    Assert (-not (Test-Path $logs)) 'dry run creates no log dir'

    # 2. accounts/... passes through unchanged; bare -Model gets prefix
    $r = Run-Launcher (@('-Config', $cfgOk, '-Model', 'accounts/fireworks/routers/x') + $common)
    Assert ($r.Out -match 'model: accounts/fireworks/routers/x\s') 'accounts/ passes through' $r.Out
    $r = Run-Launcher (@('-Config', $cfgOk, '-Model', 'kimi-k3') + $common)
    Assert ($r.Out -match 'model: accounts/fireworks/models/kimi-k3\s') 'bare -Model gets prefix'

    # 3. missing / undecryptable key -> exit 2 with -SetKey message
    $r = Run-Launcher (@('-Config', $cfgNoKey) + $common)
    Assert ($r.Code -eq 2) 'missing key exit 2' "code $($r.Code): $($r.Out)"
    Assert ($r.Out -match 'run ext-build\.ps1 -SetKey in your own PowerShell window') 'missing key message'
    $r = Run-Launcher (@('-Config', $cfgBadKey) + $common)
    Assert ($r.Code -eq 2 -and $r.Out -match '-SetKey') 'undecryptable key exit 2' "code $($r.Code): $($r.Out)"

    # 4. missing brief / cwd / config -> exit 2
    $r = Run-Launcher @('-Config', $cfgOk, '-Brief', (Join-Path $root 'nope.md'), '-Cwd', $wt, '-Step', 'S1', '-LogDir', $logs, '-DryRun')
    Assert ($r.Code -eq 2 -and $r.Out -match 'brief not found') 'missing brief exit 2' "code $($r.Code): $($r.Out)"
    $r = Run-Launcher @('-Config', $cfgOk, '-Brief', $brief, '-Cwd', (Join-Path $root 'nowt'), '-Step', 'S1', '-LogDir', $logs, '-DryRun')
    Assert ($r.Code -eq 2 -and $r.Out -match 'cwd not found') 'missing cwd exit 2' "code $($r.Code): $($r.Out)"
    $r = Run-Launcher (@('-Config', (Join-Path $root 'none.json')) + $common)
    Assert ($r.Code -eq 2 -and $r.Out -match 'config not found') 'missing config exit 2' "code $($r.Code): $($r.Out)"

    # 5. report formatting on fixtures (dot-source defines functions only)
    . $launcher
    $dot = [string][char]0x00B7
    $okJson = @'
{"type":"result","subtype":"success","is_error":false,"duration_ms":125000,"num_turns":14,
 "result":"Done: added parser.\nCommit abc1234\nlint: 0 problems\ntests: 12 passed",
 "session_id":"11111111-2222-3333-4444-555555555555","total_cost_usd":1.23,
 "usage":{"input_tokens":2000,"cache_creation_input_tokens":3000,"cache_read_input_tokens":40000,"output_tokens":5500},
 "modelUsage":{"accounts/fireworks/models/glm-5p3-flash":{"inputTokens":2000}}}
'@
    $p = ConvertFrom-ExtResult $okJson
    $rep = Format-ExtReport -Parsed $p -Step 'S1' -ModelId 'accounts/fireworks/models/glm-5p3-flash' -DurationSec 125.4 -ChildExitCode 0 -LogFile 'C:\l\S1.json'
    $want = "ext-build: S1 $dot accounts/fireworks/models/glm-5p3-flash $dot 14 turns $dot 45.0k in (40.0k cached) / 5.5k out $dot 2m05s $dot ok"
    Assert ($rep.FirstLine -eq $want) 'first line format (ok)' "got:  $($rep.FirstLine)`nwant: $want"
    Assert ($rep.ExitCode -eq 0 -and -not $rep.Handoff) 'ok -> exit 0, no handoff'
    Assert ($rep.Lines[-1] -eq 'log: C:\l\S1.json' -and $rep.Lines.Count -eq 6) 'result lines + log line' ($rep.Lines -join "`n")
    Assert ($rep.ReportedCostUsd -eq 1.23) 'cost kept only as reportedCostUsd'

    $hoText = 'HANDOFF\n' + ((1..30 | ForEach-Object { "line $_" }) -join '\n')
    $hoJson = '{"type":"result","is_error":false,"num_turns":101,"result":"' + $hoText + '","session_id":"s2"}'
    $rep = Format-ExtReport -Parsed (ConvertFrom-ExtResult $hoJson) -Step 'S2' -ModelId 'm' -DurationSec 61 -LogFile 'x'
    Assert ($rep.Handoff -and $rep.Status -eq 'HANDOFF' -and $rep.ExitCode -eq 3) 'handoff detected -> exit 3'
    Assert ($rep.FirstLine.EndsWith("1m01s $dot HANDOFF")) 'handoff first line' $rep.FirstLine
    Assert ($rep.FirstLine.Contains('0.0k in (0.0k cached) / 0.0k out')) 'missing usage tolerated' $rep.FirstLine
    Assert ($rep.Lines.Count -le 22) 'stdout capped at 22 lines' "count $($rep.Lines.Count)"

    $rep = Format-ExtReport -Parsed (ConvertFrom-ExtResult '{"is_error":true,"result":"HANDOFF but errored"}') -Step 'S3' -ModelId 'm' -DurationSec 1
    Assert ($rep.Status -eq 'failed' -and $rep.ExitCode -eq 1) 'is_error -> failed exit 1'
    $rep = Format-ExtReport -Parsed (ConvertFrom-ExtResult 'not json {') -Step 'S4' -ModelId 'm' -DurationSec 1 -ChildExitCode 0 -Stderr 'boom'
    Assert ($rep.Status -eq 'failed' -and $rep.ExitCode -eq 1 -and ($rep.Lines -join "`n") -match 'boom') 'unparsable -> failed exit 1'
    $rep = Format-ExtReport -Parsed (ConvertFrom-ExtResult '{"is_error":false,"result":"fine"}') -Step 'S5' -ModelId 'm' -DurationSec 1 -ChildExitCode 1
    Assert ($rep.ExitCode -eq 1) 'non-zero child exit -> failed'

    # 6. argument quoting round-trips quotes, backslashes and newlines
    Assert ((ConvertTo-ExtWinArg 'a "b" c\') -eq '"a \"b\" c\\"') 'windows arg quoting'

    # 7. no -Config: the user config wins if present, else the plugin default next to the script
    $home2 = Join-Path $root 'home'
    New-Item -ItemType Directory -Path (Join-Path $home2 '.claude\secrets') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $home2 '.claude\secrets\fireworks.key'), (ConvertTo-SecureString $dummy -AsPlainText -Force | ConvertFrom-SecureString))
    $r = Run-LauncherAs $home2 $common
    Assert ($r.Code -eq 0 -and $r.Out -match 'config: .*ext-build\.default\.json') 'no user config -> plugin default' "code $($r.Code): $($r.Out)"
    New-TestConfig 'home\.claude\ext-build.json' $keyFile | Out-Null
    $r = Run-LauncherAs $home2 $common
    Assert ($r.Code -eq 0 -and $r.Out -match 'config: .*home\\\.claude\\ext-build\.json') 'user config wins over the plugin default' "code $($r.Code): $($r.Out)"

    # 8. key store, one check per OS branch (no real key, Keychain, secret-tool or network)
    $sec = ConvertTo-SecureString $dummy -AsPlainText -Force
    $noCmd = { param($n) $false }
    $hasCmd = { param($n) $n -eq 'secret-tool' }
    $script:calls = New-Object System.Collections.ArrayList
    $script:vault = @{}
    $script:chmods = New-Object System.Collections.ArrayList
    $script:tamper = $false
    $script:storeFail = $false
    $mock = {
        param([string]$Exe, [string[]]$ArgList, [string]$Stdin)
        [void]$script:calls.Add([pscustomobject]@{ Exe = $Exe; Args = ($ArgList -join ' '); Stdin = $Stdin })
        $code = 0; $out = ''
        if ($Exe -eq 'chmod') { [void]$script:chmods.Add([pscustomobject]@{ Args = ($ArgList -join ' '); Len = $(if (Test-Path -LiteralPath $ArgList[1] -PathType Leaf) { (Get-Item -LiteralPath $ArgList[1]).Length } else { -1 }) }) }
        elseif ($Exe -eq 'security' -and $ArgList[0] -eq '-i') {
            if ($Stdin -match '-s (\S+) .* -w "(.*)"\n$') { $script:vault[$Matches[1]] = $(if ($script:tamper) { 'other-value' } else { $Matches[2] }) } else { $code = 1 }
        }
        elseif ($Exe -eq 'security' -and $ArgList[0] -eq 'find-generic-password') {
            $svc = $ArgList[[array]::IndexOf($ArgList, '-s') + 1]
            if ($script:vault.ContainsKey($svc)) { $out = $script:vault[$svc] + "`n" } else { $code = 44 }
        }
        elseif ($Exe -eq 'secret-tool' -and $ArgList[0] -eq 'store') { if ($script:storeFail) { $code = 1 } else { $script:vault[$ArgList[[array]::IndexOf($ArgList, 'service') + 1]] = $Stdin } }
        elseif ($Exe -eq 'secret-tool' -and $ArgList[0] -eq 'lookup') {
            $svc = $ArgList[2]
            if ($script:vault.ContainsKey($svc)) { $out = $script:vault[$svc] } else { $code = 1 }
        }
        [pscustomobject]@{ ExitCode = $code; Stdout = $out }
    }
    function Get-SetupError([scriptblock]$Block) {
        try { & $Block; return '' } catch { if ($_.Exception.Data['ExtSetup']) { return $_.Exception.Message } else { throw } }
    }

    $winKey = Join-Path $root 'ks\win\gemini.key'
    $lines = Set-ProviderKey -Provider gemini -Secure $sec -KeyFile $winKey -Os windows
    $back = Get-ProviderKey -Provider gemini -KeyFile $winKey -Os windows
    $raw = [IO.File]::ReadAllText($winKey)
    Assert ($back -eq $dummy -and -not $raw.Contains($dummy) -and -not ($lines -join ' ').Contains($dummy)) 'windows DPAPI round trip (temp folder, file encrypted)'

    $script:calls.Clear(); $script:vault.Clear()
    $lines = Set-ProviderKey -Provider openai -Secure $sec -Os macos -Runner $mock -HasCommand $noCmd
    $back = Get-ProviderKey -Provider openai -Os macos -Runner $mock -HasCommand $noCmd
    $argsSeen = ($script:calls | ForEach-Object { $_.Args }) -join ' | '
    $miss = Get-SetupError { Get-ProviderKey -Provider gemini -Os macos -Runner $mock -HasCommand $noCmd }
    Assert ($back -eq $dummy -and -not $argsSeen.Contains($dummy) -and $argsSeen -match 'find-generic-password -s ag-openai .*-w' -and $miss -match '-SetKey gemini') 'macOS Keychain (security mocked; key only on stdin)' "$argsSeen`n$miss"

    $script:calls.Clear(); $script:vault.Clear()
    $lines = Set-ProviderKey -Provider gemini -Secure $sec -Os linux -Runner $mock -HasCommand $hasCmd
    $back = Get-ProviderKey -Provider gemini -Os linux -Runner $mock -HasCommand $hasCmd
    $argsSeen = ($script:calls | ForEach-Object { $_.Args }) -join ' | '
    Assert ($back -eq $dummy -and -not $argsSeen.Contains($dummy) -and $script:calls[0].Stdin -eq $dummy -and $argsSeen -match '^store .*service ag-gemini') 'linux secret-tool (mocked; secret on stdin)' $argsSeen

    $script:calls.Clear()
    $linKey = Join-Path $root 'ks\linux\gemini.key'
    $lines = Set-ProviderKey -Provider gemini -Secure $sec -KeyFile $linKey -Os linux -Runner $mock -HasCommand $noCmd
    $back = Get-ProviderKey -Provider gemini -KeyFile $linKey -Os linux -Runner $mock -HasCommand $noCmd
    $chmod = @($script:calls | Where-Object { $_.Exe -eq 'chmod' -and $_.Args -eq "600 $linKey" }).Count
    Assert ($back -eq $dummy -and $chmod -eq 1 -and ($lines -join ' ') -match 'NOT encrypted' -and -not ($lines -join ' ').Contains($dummy)) 'linux fallback file (chmod 600, says unencrypted)' ($lines -join "`n")

    # fix 16 (6): folder 700 and empty file 600 before the key is written
    $c700 = [array]::IndexOf(@($script:chmods | ForEach-Object { $_.Args }), "700 $(Split-Path -Parent $linKey)")
    $c600 = [array]::IndexOf(@($script:chmods | ForEach-Object { $_.Args }), "600 $linKey")
    Assert ($c700 -ge 0 -and $c600 -gt $c700 -and $script:chmods[$c600].Len -eq 0) 'linux file: secrets folder 700, then empty key file 600, then the key' (($script:chmods | ForEach-Object { "$($_.Args) len=$($_.Len)" }) -join "`n")

    # fix 16 (5): secret-tool store fails (no unlocked keyring) -> mode-600 file, says unencrypted
    $script:calls.Clear(); $script:vault.Clear(); $script:chmods.Clear(); $script:storeFail = $true
    $failKey = Join-Path $root 'ks\linux2\gemini.key'
    $lines = Set-ProviderKey -Provider gemini -Secure $sec -KeyFile $failKey -Os linux -Runner $mock -HasCommand $hasCmd
    $back = Get-ProviderKey -Provider gemini -KeyFile $failKey -Os linux -Runner $mock -HasCommand $hasCmd
    $script:storeFail = $false
    $txt = $lines -join ' '
    Assert ($back -eq $dummy -and $txt -match 'NOT encrypted' -and $txt -match 'secret-tool could not store' -and -not $txt.Contains($dummy) -and @($script:chmods | Where-Object { $_.Args -eq "600 $failKey" }).Count -eq 1) 'linux secret-tool store fails -> 600 file fallback, says unencrypted' $txt

    # fix 16 (7): macOS read-back differs from the new key -> setup failure (exit 2), no value shown
    $script:calls.Clear(); $script:vault.Clear(); $script:tamper = $true
    $msg = Get-SetupError { Set-ProviderKey -Provider openai -Secure $sec -Os macos -Runner $mock -HasCommand $noCmd }
    $script:tamper = $false
    Assert ($msg -match 'does not match' -and -not $msg.Contains($dummy) -and -not $msg.Contains('other-value')) 'macOS read-back mismatch -> setup error, values never shown' $msg

    # fix 16 (1): on macOS/Linux plain `claude` is found (Get-Command mocked)
    function Get-Command {
        param([Parameter(Position = 0)][string]$Name, [string]$CommandType)
        if ($Name -eq 'claude') { return [pscustomobject]@{ Source = '/usr/local/bin/claude' } }
    }
    $found = Resolve-ExtClaude ([pscustomobject]@{ ClaudePath = '' }) 'linux'
    $foundMac = Resolve-ExtClaude ([pscustomobject]@{ ClaudePath = '' }) 'macos'
    Remove-Item -LiteralPath function:Get-Command
    Assert ($found -eq '/usr/local/bin/claude' -and $foundMac -eq '/usr/local/bin/claude') 'non-Windows finds plain claude on PATH' "$found / $foundMac"

    # fix 17: -Where names the store, the file and set / not set, never the key
    $r = Run-Launcher @('-Config', $cfgOk, '-Where')
    $r2 = Run-Launcher @('-Config', $cfgNoKey, '-Where', 'fireworks')
    Assert ($r.Code -eq 0 -and $r.Out -match 'fireworks store: windows-dpapi' -and $r.Out.Contains("fireworks location: file $keyFile") -and $r.Out -match 'fireworks key: set' -and $r2.Code -eq 0 -and $r2.Out -match 'fireworks key: not set' -and -not ($r.Out + $r2.Out).Contains($dummy)) '-Where: store, file, set / not set, no key' "$($r.Out)`n$($r2.Out)"

    # fix 17: ag-key.ps1 runs the newest installed version, else the checkout; exit code passes through
    $agKey = Join-Path $PSScriptRoot 'ag-key.ps1'
    $ch = Join-Path $root 'claudehome'
    $co = Join-Path $root 'checkout'
    $cache = Join-Path $ch 'plugins\cache\agents-plugin\ag'
    foreach ($d in @("$cache\1.9.0\scripts", "$cache\1.10.0\scripts", "$co\plugins\ag\scripts")) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $d 'design-image.ps1'), "Write-Output ('ran ' + `$PSScriptRoot + ' ' + (`$args -join ' ')); exit 7")
    }
    . $agKey
    $newest = Resolve-AgKeyScripts $ch $co
    $fallback = Resolve-AgKeyScripts (Join-Path $root 'nohome') $co
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $agKey where gemini -ClaudeHome $ch 2>&1 | Out-String
    $code = $LASTEXITCODE
    Assert ($newest -eq "$cache\1.10.0\scripts" -and $fallback -eq "$co\plugins\ag\scripts" -and $code -eq 7 -and $out -match '1\.10\.0\\scripts -Where gemini') 'ag-key: newest version wins (1.10.0 > 1.9.0), else the checkout; exit code passed through' "$newest | $fallback | $code | $out"

    # S15: a real run registers its own job in the project's progress file, and removes it in a finally.
    # claude is mocked (the mock reads the progress file while the run is "going on") and so is the exe lookup.
    function Resolve-ExtClaude($Cfg, [string]$Os) { return 'claude-mock' }
    $script:progPath = ''
    $script:during = ''
    function Invoke-ExtClaude([string]$Exe, [string[]]$ArgList, $EnvMap, [string]$WorkDir, [string]$StdinText) {
        $script:during = if (Test-Path -LiteralPath $script:progPath) { [IO.File]::ReadAllText($script:progPath) } else { '' }
        return [pscustomobject]@{ ExitCode = 0; Stdout = $script:okJson; Stderr = '' }
    }
    # The launcher's own parameters, as its entry point sets them: a real run of the dot-sourced Invoke-ExtMain.
    # ($Brief is the same variable as $brief: dot-sourcing the launcher bound it to its empty default.)
    $Config = $cfgOk; $Brief = Join-Path $root 'brief.md'; $LogDir = (Join-Path $root 'plogs')
    $Model = ''; $Resume = ''; $MaxBudgetUsd = 0; $Provider = ''
    $DryRun = $false; $SetKey = $false; $Check = $false; $Where = $false

    $proj = Join-Path $root 'proj'
    New-Item -ItemType Directory -Path (Join-Path $proj '.claude') -Force | Out-Null
    $script:progPath = Join-Path $proj '.claude\goal-progress.json'
    [IO.File]::WriteAllText($script:progPath, '{"goal":"g","status":"running","updated":"2026-11-07T00:00:00.0000000Z","running":[{"kind":"deploy","title":"Keep me","since":"2026-11-07T00:00:00.0000000Z"}]}')

    $Cwd = $proj; $Step = 'S15'
    $code = Invoke-ExtMain | Select-Object -Last 1
    $during = $script:during | ConvertFrom-Json
    $mine = @($during.running | Where-Object { $_.kind -eq 'build' })
    $after = [IO.File]::ReadAllText($script:progPath) | ConvertFrom-Json
    $kept = @($after.running)
    Assert ($code -eq 0 -and @($during.running).Count -eq 2 -and $mine.Count -eq 1 -and $mine[0].title -eq 'S15' -and $mine[0].engine -eq 'fw:glm-5p3-flash' -and $mine[0].since) 'run adds its build job while running (engine fw:glm-5p3-flash)' $script:during
    Assert ($kept.Count -eq 1 -and $kept[0].title -eq 'Keep me' -and $after.updated -ne '2026-11-07T00:00:00.0000000Z' -and -not (Test-Path -Path "$($script:progPath).tmp-*")) 'run removes its job after (other jobs kept, updated set, no temp file left)' ([IO.File]::ReadAllText($script:progPath))

    # S15: a missing progress file is left alone and never created
    $bare = Join-Path $root 'bare'
    New-Item -ItemType Directory -Path $bare | Out-Null
    $script:progPath = Join-Path $bare '.claude\goal-progress.json'
    $Cwd = $bare; $Step = 'S15b'
    $code = Invoke-ExtMain | Select-Object -Last 1
    Assert ($code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $bare '.claude')) -and -not (Test-Path -LiteralPath $script:progPath)) 'a missing progress file is not created' "code $code"

    # S15: a worktree Cwd writes the main checkout's progress file
    $mainco = Join-Path $root 'mainco'
    $wtree = Join-Path $mainco '.claude\worktrees\w1'
    New-Item -ItemType Directory -Path $wtree -Force | Out-Null
    $script:progPath = Join-Path $mainco '.claude\goal-progress.json'
    [IO.File]::WriteAllText($script:progPath, '{"goal":"g","status":"running","updated":"2026-11-07T00:00:00.0000000Z"}')
    $Cwd = $wtree; $Step = 'S15w'
    $code = Invoke-ExtMain | Select-Object -Last 1
    $duringW = $script:during | ConvertFrom-Json
    $afterW = [IO.File]::ReadAllText($script:progPath) | ConvertFrom-Json
    Assert ($code -eq 0 -and @($duringW.running).Count -eq 1 -and @($duringW.running)[0].title -eq 'S15w' -and -not (Test-Path -LiteralPath (Join-Path $wtree '.claude'))) 'a worktree Cwd writes the main checkout progress file' $script:during
    Assert (@($afterW.running).Count -eq 0) 'the worktree run removes its job from the main file' ([IO.File]::ReadAllText($script:progPath))

    $r = Run-Launcher @('-Config', $cfgOk, '-Check', 'bogus')
    Assert ($r.Code -eq 2 -and $r.Out -match "unknown key provider 'bogus'") 'unknown provider exit 2' "code $($r.Code): $($r.Out)"
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "ext-build tests: $script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 } else { exit 0 }
