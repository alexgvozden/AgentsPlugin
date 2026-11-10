# Self-test for fable-planning.ps1 (no Pester). Works in a temp project folder only.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File fable-planning.test.ps1
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'fable-planning.ps1'
$script:fail = 0
$script:pass = 0

function Assert([bool]$Cond, [string]$Name, [string]$Detail = '') {
    if ($Cond) { $script:pass++; Write-Host "PASS $Name" }
    else { $script:fail++; Write-Host "FAIL $Name" -ForegroundColor Red; if ($Detail) { Write-Host $Detail } }
}

function Run([string[]]$ArgList) {
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script @ArgList 2>&1 | Out-String
    [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

function Read-Json([string]$Path) { [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json }

$root = Join-Path ([IO.Path]::GetTempPath()) ('fable-planning-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$cfg = Join-Path $root '.claude\ag.json'
$local = Join-Path $root '.claude\settings.local.json'
try {
    # default off, no file
    $r = Run @('status', '-ProjectDir', $root)
    Assert ($r.Code -eq 0 -and $r.Out -match 'fable-planning: off') 'status is off with no ag.json' $r.Out
    Assert (-not (Test-Path $cfg)) 'status writes nothing'

    $r = Run @('off', '-ProjectDir', $root)
    Assert ($r.Code -eq 0 -and $r.Out -match 'skip:') 'off with no file is a skip' $r.Out
    Assert (-not (Test-Path $cfg)) 'off with no file writes nothing'

    # on writes only ag.json
    $r = Run @('on', '-ProjectDir', $root)
    Assert ($r.Code -eq 0 -and $r.Out -match 'done: fable-planning on') 'on reports done' $r.Out
    Assert ((Read-Json $cfg).fablePlanning -eq $true) 'on sets fablePlanning'
    Assert (-not (Test-Path $local)) 'on does not touch settings.local.json (the session model)'

    $r = Run @('status', '-ProjectDir', $root)
    Assert ($r.Out -match 'fable-planning: on') 'status is on after on' $r.Out
    $r = Run @('on', '-ProjectDir', $root)
    Assert ($r.Out -match 'skip:') 'second on is a skip' $r.Out

    # off removes the file when nothing else is in it
    $r = Run @('off', '-ProjectDir', $root)
    Assert ($r.Code -eq 0 -and $r.Out -match 'done: fable-planning off') 'off reports done' $r.Out
    Assert (-not (Test-Path $cfg)) 'off removes an ag.json left empty'

    # other keys are kept, both ways
    [System.IO.File]::WriteAllText($cfg, '{"other":{"list":["a"]},"fablePlanning":false}')
    $r = Run @('status', '-ProjectDir', $root)
    Assert ($r.Out -match 'fable-planning: off') 'false reads as off' $r.Out
    $r = Run @('on', '-ProjectDir', $root)
    $j = Read-Json $cfg
    Assert ($j.fablePlanning -eq $true -and $j.other.list[0] -eq 'a') 'on keeps other keys'
    $r = Run @('off', '-ProjectDir', $root)
    $j = Read-Json $cfg
    Assert ((Test-Path $cfg) -and $j.other.list[0] -eq 'a') 'off keeps the file and other keys'
    Assert (-not ($j.PSObject.Properties.Name -contains 'fablePlanning')) 'off removes the key'

    # bad input
    $r = Run @('maybe', '-ProjectDir', $root)
    Assert ($r.Code -eq 2) 'unknown mode exits 2' $r.Out
    [System.IO.File]::WriteAllText($cfg, '{ not json')
    $r = Run @('on', '-ProjectDir', $root)
    Assert ($r.Code -eq 2 -and ([System.IO.File]::ReadAllText($cfg) -eq '{ not json')) 'broken JSON exits 2 and is left alone' $r.Out
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
